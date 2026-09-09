import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateCommentTool, EditCommentTool, ReportProgressTool } from "../mcp/comment.ts";
import { ReviewCheckpointTool } from "../mcp/reviewCheckpoint.ts";
import type { ToolContext } from "../mcp/server.ts";
import { computeModes } from "../modes.ts";
import { initToolState, primaryRepoState } from "../toolState.ts";
import { createReviewCoverage, currentReviewCoverage, incompleteReviewIssue, loadReviewManifest, missingReviewPasses, planReview, recordReviewPasses, reviewCompletionBody, reviewPublicationBody, type LensDecision, type ReviewCoverage, type ReviewPass } from "./reviewCoverage.ts";
import { REVIEW_LENSES } from "./reviewLenses.ts";

let root: string;
let coverage: ReviewCoverage;
const decisions = (): LensDecision[] => Object.keys(REVIEW_LENSES).map(id => ({ id: id as LensDecision["id"], status: id === "B" ? "selected" : "not_applicable", reason: id === "B" ? "Renamed interface affects consumers." : "The delta changes no behavior governed by this lens." }));
const evidence = [{ reference: "source.ts:2", trace: ["producer emits renamed field", "consumer reads renamed field"], outcome: "Both names agree; no stale consumer remains." }];
const pass = (id: string): ReviewPass => ({ id, status: "completed", evidence });

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function context(mode = "Review") {
  const toolState = initToolState({ owner: "test", name: "repo", dir: root, progressComment: undefined });
  const repo = primaryRepoState(toolState);
  repo.issueNumber = 1;
  repo.checkoutSha = coverage.scope.headSha;
  repo.reviewCoverage = coverage;
  toolState.selectedMode = mode;
  toolState.agent = "codex";
  return { agentId: "codex" as const, toolState };
}

function manifest(overrides: Record<string, unknown> = {}) {
  const data = {
    version: 2,
    changed_files: coverage.scope.changedFiles,
    instruction_files: [{ path: "AGENTS.md", sha256: createHash("sha256").update(readFileSync(join(root, "AGENTS.md"))).digest("hex") }],
    mechanical_checks: [
      { id: "rule:1", source: "AGENTS.md", class: "sweep", applies_to_diff: true },
      { id: "rule:2", source: "AGENTS.md", class: "sweep", applies_to_diff: false },
      { id: "rule:3", source: "AGENTS.md", class: "procedure", applies_to_diff: true },
      { id: "rule:4", source: "AGENTS.md", class: "invariant", applies_to_diff: true, enforced_by: "AGENTS.md" },
    ],
    ...overrides,
  };
  const path = join(root, "manifest.json");
  writeFileSync(path, JSON.stringify(data));
  return loadReviewManifest(path, root, root, coverage.scope);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pullfrog-review-coverage-"));
  git("init", "-q");
  git("config", "user.name", "Review test");
  git("config", "user.email", "review@example.invalid");
  writeFileSync(join(root, "AGENTS.md"), "Inspect every consumer of a renamed field.\n");
  git("add", "AGENTS.md");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  const diffPath = join(root, "full.diff");
  writeFileSync(diffPath, "-oldName\n+newName\n");
  coverage = createReviewCoverage({ pullNumber: 1, headSha: git("rev-parse", "HEAD"), baseSha: "base", changedFiles: ["old/source.ts", "new/source.ts"], changedFilesPath: join(root, "files.txt"), diffPath });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("review manifest and scope", () => {
  it("accounts for excluded checks and runs only applicable sweeps", async () => {
    const imported = manifest();
    expect(imported.required).toEqual(["sweep:rule:1"]);
    expect(imported.excluded).toEqual([{ id: "rule:2", reason: "out_of_scope" }, { id: "rule:3", reason: "author_procedure" }, { id: "rule:4", reason: "ci_owned" }]);
    planReview(coverage, decisions(), imported);
    expect(missingReviewPasses(coverage)).toEqual(["correctness", "conventions", "documentation", "verification", "B", "sweep:rule:1"]);
  });
  it("rejects a partial file list, including a lost rename source", async () => {
    expect(() => manifest({ changed_files: ["new/source.ts"] })).toThrow("changed_files differ");
  });
  it("rejects duplicate and unclassified check IDs", async () => {
    const check = { id: "rule:1", source: "AGENTS.md", class: "sweep", applies_to_diff: true };
    expect(() => manifest({ mechanical_checks: [check, check] })).toThrow("duplicate");
    expect(() => manifest({ mechanical_checks: [{ ...check, class: "unclassified" }] })).toThrow("Unclassified");
  });
  it("rejects an absent provider explanation or a missing lens decision", async () => {
    expect(() => planReview(coverage, decisions(), undefined)).toThrow("Supply a manifest");
    expect(() => planReview(coverage, decisions().slice(1), manifest())).toThrow("every lens");
  });
  it("rejects source hashes from another revision", async () => {
    expect(() => manifest({ instruction_files: [{ path: "AGENTS.md", sha256: "stale" }] })).toThrow("Guidance changed");
  });
  it("preserves filenames with whitespace and control characters", async () => {
    const special = createReviewCoverage({ ...coverage.scope, changedFiles: ["old name.ts", "new\nname.ts", "a\\b.ts"] });
    expect(readFileSync(special.scope.changedFilesPath, "utf8").trim().split("\n").map(line => JSON.parse(line))).toEqual(special.scope.changedFiles);
  });
  it("invalidates a changed checkout, wrong review ID, and modified diff artifact", async () => {
    const ctx = context();
    await expect(currentReviewCoverage(ctx, "other")).rejects.toThrow("stale");
    writeFileSync(coverage.scope.diffPath, "another diff");
    await expect(currentReviewCoverage(ctx)).rejects.toThrow("artifacts changed");
  });
  it("detects rewritten submodules even when the PR sets ignore=all", async () => {
    git("init", "-q", "dependency-origin");
    git("-C", "dependency-origin", "config", "user.name", "Review test");
    git("-C", "dependency-origin", "config", "user.email", "review@example.invalid");
    writeFileSync(join(root, "dependency-origin", "source.ts"), "export const value = 1;\n");
    git("-C", "dependency-origin", "add", "source.ts");
    git("-C", "dependency-origin", "-c", "commit.gpgsign=false", "commit", "-qm", "dependency");
    git("-c", "protocol.file.allow=always", "submodule", "add", "./dependency-origin", "dependency");
    git("config", "-f", ".gitmodules", "submodule.dependency.ignore", "all");
    git("add", ".gitmodules", "dependency");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "ignored dependency");
    const { id: _, ...scope } = coverage.scope;
    coverage = createReviewCoverage({ ...scope, headSha: git("rev-parse", "HEAD") });
    const ctx = context();
    writeFileSync(join(root, "dependency", "source.ts"), "export const value = 2;\n");
    expect(git("diff", "--quiet", "HEAD")).toBe("");
    await expect(currentReviewCoverage(ctx)).rejects.toThrow("Tracked checkout content changed");
    git("-C", "dependency", "add", "source.ts");
    git("-C", "dependency", "-c", "commit.gpgsign=false", "-c", "user.name=Review test", "-c", "user.email=review@example.invalid", "commit", "-qm", "rewritten dependency");
    expect(git("diff", "--quiet", "HEAD")).toBe("");
    await expect(currentReviewCoverage(ctx)).rejects.toThrow("Tracked checkout content changed");
  });
  it("does not execute a repository fsmonitor helper during coverage checks", async () => {
    const hook = join(root, "fsmonitor.sh");
    writeFileSync(hook, "#!/bin/sh\necho invoked > fsmonitor-invoked\n", { mode: 0o755 });
    git("config", "core.fsmonitor", hook);
    await currentReviewCoverage(context());
    expect(existsSync(join(root, "fsmonitor-invoked"))).toBe(false);
  });
  it("distinguishes two incremental baselines at the same head", async () => {
    const first = createReviewCoverage({ ...coverage.scope, beforeSha: "first" });
    const second = createReviewCoverage({ ...coverage.scope, beforeSha: "second" });
    expect(first.scope.id).not.toBe(second.scope.id);
  });
});

describe("single-session completion", () => {
  it("rejects an evidence-free selected lens and premature verification", async () => {
    planReview(coverage, decisions(), manifest());
    expect(() => recordReviewPasses(coverage, [{ ...pass("B"), evidence: [] }])).toThrow("needs concrete");
    expect(() => recordReviewPasses(coverage, [{ ...pass("B"), evidence: [{ ...evidence[0]!, trace: ["checked"] }] }])).toThrow("at least two");
    expect(() => recordReviewPasses(coverage, [pass("verification")])).toThrow("other required");
    expect(coverage.passes).toEqual({});
  });
  it.each(["Review", "IncrementalReview"])("blocks every clean %s exit until required passes finish", async mode => {
    const ctx = context(mode);
    await expect(reviewCompletionBody(ctx, "No new issues", true)).rejects.toThrow("coverage incomplete");
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, coverage.plan!.required.filter(id => id !== "verification").map(pass));
    await expect(reviewCompletionBody(ctx, "No new issues", true)).rejects.toThrow("verification");
    recordReviewPasses(coverage, [pass("verification")]);
    expect(await reviewCompletionBody(ctx, "No new issues", true)).toBe("No new issues");
    expect(await incompleteReviewIssue(ctx.toolState)).toBeUndefined();
  });
  it("failed sweeps stay incomplete and cannot be verified", async () => {
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, [{ id: "sweep:rule:1", status: "incomplete", evidence: [{ reference: "shell call 12", trace: ["grep tried source.ts"], outcome: "command failed with exit 2; no scan result" }] }]);
    expect(missingReviewPasses(coverage)).toContain("sweep:rule:1");
    expect(() => recordReviewPasses(coverage, [pass("verification")])).toThrow();
  });
  it("permits explicit incomplete reports, never approval or clean language", async () => {
    const ctx = context();
    coverage.limitation = "Required database tooling is unavailable after retry.";
    expect(await reviewCompletionBody(ctx, "Verified finding: stale consumer.")).toContain("Review incomplete:");
    expect(await reviewCompletionBody(ctx, "LGTM; ready to merge. No new issues.")).not.toContain("LGTM");
    expect(await reviewCompletionBody(ctx, "All changes are correct.")).toContain("No clean verdict was reached.");
    await expect(reviewCompletionBody(ctx, "Some findings", true)).rejects.toThrow("cannot approve");
  });
  it("keeps an explicit limitation authoritative after passes were recorded", async () => {
    const ctx = context();
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, coverage.plan!.required.map(pass));
    coverage.limitation = "The final reproduction could not be completed.";
    await expect(reviewCompletionBody(ctx, "LGTM", true)).rejects.toThrow("cannot approve");
    expect(await reviewCompletionBody(ctx, "LGTM")).toContain("Review incomplete:");
    expect(await reviewCompletionBody(ctx, "LGTM")).not.toContain("LGTM");
  });
  it("keeps manifest IDs out of the public incomplete summary", async () => {
    const ctx = context();
    planReview(coverage, decisions(), manifest({ mechanical_checks: [{ id: "unsafe\n@someone `markdown`", source: "AGENTS.md", class: "sweep", applies_to_diff: true }] }));
    coverage.limitation = "Required scan is unavailable.";
    expect(await reviewCompletionBody(ctx, "Incomplete review")).not.toContain("@someone");
    expect(await reviewCompletionBody(ctx, "Incomplete review")).not.toContain("markdown");
  });
  it("rechecking an earlier pass invalidates final verification", async () => {
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, coverage.plan!.required.map(pass));
    recordReviewPasses(coverage, [pass("B")]);
    expect(missingReviewPasses(coverage)).toEqual(["verification"]);
  });
  it("rewritten guidance cannot certify itself with a fresh manifest", async () => {
    const ctx = context();
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, coverage.plan!.required.map(pass));
    writeFileSync(join(root, "AGENTS.md"), "Changed guidance\n");
    await expect(reviewCompletionBody(ctx, "No new issues", true)).rejects.toThrow("Tracked checkout content changed");
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, coverage.plan!.required.map(pass));
    await expect(reviewCompletionBody(ctx, "No new issues", true)).rejects.toThrow("Tracked checkout content changed");
  });
  it("keeps other harnesses and non-review modes unaffected", async () => {
    expect(await reviewCompletionBody({ ...context(), agentId: "opencode" }, "No new issues", true)).toBe("No new issues");
    expect(await reviewCompletionBody(context("Build"), "Built feature")).toBe("Built feature");
  });
  it("Codex full/incremental prompts use passes while other harnesses retain specialists", async () => {
    for (const name of ["Review", "IncrementalReview"]) {
      const codex = computeModes("codex").find(mode => mode.name === name)!.prompt!;
      expect(codex).toContain("Single-session review coverage");
      expect(codex).not.toContain("**specialist decision**");
      expect(codex).toContain("review_checkpoint");
      expect(computeModes("opencode").find(mode => mode.name === name)!.prompt).toContain("**specialist decision**");
    }
  });
});


describe("review_checkpoint tool", () => {
  it.each(["Review", "IncrementalReview"])("plans and records %s coverage through the MCP boundary", async mode => {
    const ctx = { ...context(mode), tmpdir: root } as ToolContext;
    const checkpoint = ReviewCheckpointTool(ctx);
    const call = (params: Parameters<typeof checkpoint.execute>[0]) => checkpoint.execute(params, {} as never);
    const review_id = coverage.scope.id;
    const planned = await call({ action: "plan", review_id, lenses: decisions(), no_manifest_reason: "Checked root instructions and scripts; this fixture has no governance provider." });
    expect(planned).not.toHaveProperty("isError", true);
    expect(coverage.plan!.required).toContain("B");
    const premature = await call({ action: "record", review_id, passes: [pass("verification")] });
    expect(premature).toHaveProperty("isError", true);
    const recorded = await call({ action: "record", review_id, passes: coverage.plan!.required.map(pass) });
    expect(recorded).not.toHaveProperty("isError", true);
    expect(await reviewCompletionBody(ctx, "No new issues.", true)).toBe("No new issues.");
    const stale = await call({ action: "record", review_id: "previous-head", passes: [pass("B")] });
    expect(stale).toHaveProperty("isError", true);
  });

  it("declares a visible limitation and rejects non-Codex sessions", async () => {
    const ctx = { ...context(), tmpdir: root } as ToolContext;
    const params = { action: "incomplete" as const, review_id: coverage.scope.id, reason: "Manifest provider failed after retry." };
    const result = await ReviewCheckpointTool(ctx).execute(params, {} as never);
    expect(result).not.toHaveProperty("isError", true);
    expect(await reviewCompletionBody(ctx, "Verified finding.")).toContain(params.reason);
    await expect(reviewCompletionBody(ctx, "No new issues.", true)).rejects.toThrow();
    const unsupported = await ReviewCheckpointTool({ ...ctx, agentId: "opencode" }).execute(params, {} as never);
    expect(unsupported).toHaveProperty("isError", true);
  });
});


describe("review publication freshness", () => {
  it.each(["Review", "IncrementalReview"])("binds every comment completion path to its actual target in %s", async mode => {
    const ctx = context(mode);
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, coverage.plan!.required.map(pass));
    const createComment = vi.fn();
    const updateComment = vi.fn();
    const publication = {
      ...ctx,
      repo: { owner: "test", name: "repo" },
      payload: { event: { issue_number: 2 } },
      octokit: { rest: {
        pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: coverage.scope.headSha }, base: { sha: coverage.scope.baseSha } } }) },
        issues: { createComment, updateComment, getComment: vi.fn().mockResolvedValue({ data: { issue_url: "https://api.github.com/repos/test/repo/issues/2" } }) },
      } },
    } as unknown as ToolContext;
    for (const result of [
      await CreateCommentTool(publication).execute({ issueNumber: 2, body: "No new issues" }, {} as never),
      await ReportProgressTool(publication).execute({ body: "No new issues" }, {} as never),
      await EditCommentTool(publication).execute({ commentId: 5, body: "No new issues" }, {} as never),
    ]) {
      expect(result).toHaveProperty("isError", true);
      expect(JSON.stringify(result)).toContain("Publication target differs");
    }
    // Publishing to the checked-out PR must still enforce coverage when the event targets another PR.
    coverage.passes = {};
    const missing = await CreateCommentTool(publication).execute({ issueNumber: 1, body: "No new issues" }, {} as never);
    expect(missing).toHaveProperty("isError", true);
    expect(JSON.stringify(missing)).toContain("Review coverage incomplete");
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it.each(["Review", "IncrementalReview"])("reports missing checkout coverage in %s", async mode => {
    const ctx = context(mode);
    primaryRepoState(ctx.toolState).reviewCoverage = undefined;
    expect(await incompleteReviewIssue(ctx.toolState)).toContain("checkout_pr");
    ctx.toolState.agent = "opencode";
    expect(await incompleteReviewIssue(ctx.toolState)).toBeUndefined();
  });

  it.each(["head", "base"])("rejects an advanced remote %s with unchanged local artifacts", async changed => {
    const ctx = context();
    planReview(coverage, decisions(), manifest());
    recordReviewPasses(coverage, coverage.plan!.required.map(pass));
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: coverage.scope.headSha }, base: { sha: coverage.scope.baseSha } } });
    const publication = { ...ctx, repo: { owner: "test", name: "repo" }, octokit: { rest: { pulls: { get } } } } as unknown as ToolContext;
    await expect(reviewPublicationBody(publication, "No new issues", 1, true)).resolves.toBe("No new issues");
    await expect(reviewPublicationBody(publication, "No new issues", 2)).rejects.toThrow("Publication target differs");
    await expect(reviewPublicationBody({ ...publication, repo: { ...publication.repo, name: "other" } }, "No new issues", 1)).rejects.toThrow("Publication target differs");
    get.mockResolvedValue({ data: { head: { sha: changed === "head" ? "new-head" : coverage.scope.headSha }, base: { sha: changed === "base" ? "new-base" : coverage.scope.baseSha } } });
    await expect(reviewPublicationBody(publication, "No new issues", 1, true)).rejects.toThrow("remote PR revision changed");
  });
});
