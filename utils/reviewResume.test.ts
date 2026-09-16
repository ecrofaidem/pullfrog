import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewCoverage, planReview, recordReviewPasses } from "./reviewCoverage.ts";
import { REVIEW_LENSES } from "./reviewLenses.ts";
import { appendReviewReceipt, attestReviewReceipt, applyReviewResume, createReviewReadState, createReviewReceipt, fetchReviewReceipt, parseReviewReceipt, stripReviewReceipt } from "./reviewResume.ts";
import type { ToolContext } from "../mcp/server.ts";

let root: string;
const patch = (file: string, value: string) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+${value}\n`;
const sources = [{ path: "AGENTS.md", sha256: "a".repeat(64) }];
const lenses = () => Object.keys(REVIEW_LENSES).map(id => ({ id: id as keyof typeof REVIEW_LENSES, status: "not_applicable" as const, reason: "No behavior in this lens changes." }));
function scope(headSha = "b".repeat(40), beforeSha?: string) {
  const diffPath = join(root, `${headSha}.diff`);
  const rawPath = join(root, `${headSha}.raw.diff`);
  const deltaPath = beforeSha ? join(root, `${headSha}.delta.diff`) : undefined;
  writeFileSync(diffPath, "display\n");
  writeFileSync(rawPath, patch("first.ts", "one") + patch("second.ts", "two"));
  if (deltaPath) writeFileSync(deltaPath, "incremental delta\n");
  const coverage = createReviewCoverage({ pullNumber: 42, headSha, baseSha: "c".repeat(40), beforeSha, changedFiles: ["first.ts", "second.ts"], changedFilesPath: join(root, `${headSha}.files`), diffPath, unifiedDiffPath: rawPath, incrementalDiffPath: deltaPath });
  coverage.readCoverage = [createReviewReadState(rawPath), ...(deltaPath ? [createReviewReadState(deltaPath)] : [])];
  return coverage;
}
function plan(coverage: ReturnType<typeof scope>, instructionSources = sources) {
  planReview(coverage, lenses(), { sources: instructionSources, required: [], excluded: [], manifestHash: "manifest" });
}
function complete(coverage: ReturnType<typeof scope>) {
  for (const state of coverage.readCoverage!) state.coveredRanges = [{ startLine: 1, endLine: state.totalLines }];
  recordReviewPasses(coverage, coverage.plan!.required.map(id => ({ id, status: "completed", evidence: [{ reference: "first.ts:1", trace: ["inspected current scope"], outcome: "No issue found in this pass." }] })));
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "review-resume-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("review receipts", () => {
  it("keeps unfinished work explicit without crediting reads from an incomplete session", () => {
    const previous = scope();
    plan(previous);
    previous.readCoverage![0]!.coveredRanges = [{ startLine: 1, endLine: 6 }];
    const receipt = createReviewReceipt("owner/repo", previous)!;
    expect(receipt.complete).toBe(false);
    expect(receipt.readSections).toHaveLength(1);
    expect(receipt.remainingPasses).toContain("verification");
    const current = scope("d".repeat(40), previous.scope.headSha);
    current.previousReceipt = receipt;
    plan(current);
    applyReviewResume(current);
    expect(current.analysisScope).toBe("full");
    expect(current.readCoverage![0]!.coveredRanges).toEqual([]);
    expect(() => recordReviewPasses(current, current.plan!.required.map(id => ({ id, status: "completed", evidence: [{ reference: "second.ts", trace: ["read new scope"], outcome: "Checked current inputs." }] })))).toThrow("diff");
    expect(current.passes).toEqual({});
  });

  it("reuses unchanged sections and reviews a new delta only after a complete baseline", () => {
    const previous = scope();
    plan(previous);
    complete(previous);
    const current = scope("d".repeat(40), previous.scope.headSha);
    writeFileSync(current.scope.unifiedDiffPath!, patch("first.ts", "one") + patch("second.ts", "three"));
    current.readCoverage![0] = createReviewReadState(current.scope.unifiedDiffPath!);
    current.previousReceipt = createReviewReceipt("owner/repo", previous)!;
    plan(current);
    applyReviewResume(current);
    expect(current.analysisScope).toBe("incremental");
    expect(current.readCoverage![0]!.coveredRanges).toEqual([{ startLine: 1, endLine: 6 }]);
    expect(current.readCoverage![1]!.coveredRanges).toEqual([]);
    expect(current.passes).toEqual({});
  });

  it.each(["base", "guidance", "baseline", "missing manifest", "missing delta"])("invalidates inherited coverage when %s changes", kind => {
    const previous = scope(); plan(previous); complete(previous);
    const current = scope("d".repeat(40), kind === "baseline" ? "e".repeat(40) : previous.scope.headSha);
    current.previousReceipt = createReviewReceipt("owner/repo", previous)!;
    if (kind === "base") current.scope.baseSha = "f".repeat(40);
    if (kind === "missing delta") current.scope.incrementalDiffPath = undefined;
    plan(current, kind === "guidance" ? [{ ...sources[0]!, sha256: "b".repeat(64) }] : kind === "missing manifest" ? [] : sources);
    applyReviewResume(current);
    expect(current.analysisScope).toBe("full");
    expect(current.readCoverage![0]!.coveredRanges).toEqual([]);
  });

  it("round-trips a bounded receipt and removes agent-supplied markers", () => {
    const previous = scope(); plan(previous); complete(previous);
    const receipt = createReviewReceipt("owner/repo", previous)!;
    const body = appendReviewReceipt("A useful review.", receipt);
    expect(parseReviewReceipt(body)).toEqual(receipt);
    expect(stripReviewReceipt(body)).toBe("A useful review.");
    const replaced = appendReviewReceipt(body, { ...receipt, complete: false });
    expect(parseReviewReceipt(replaced)?.complete).toBe(false);
    expect(replaced.match(/PULLFROG_REVIEW_COVERAGE_V1/g)).toHaveLength(1);
    expect(parseReviewReceipt("<!-- PULLFROG_REVIEW_COVERAGE_V1 garbage -->")).toBeUndefined();
  });

  it("never calls unread raw content a complete review", () => {
    const previous = scope(); plan(previous);
    expect(() => recordReviewPasses(previous, previous.plan!.required.map(id => ({ id, status: "completed", evidence: [{ reference: "first.ts", trace: ["looked"], outcome: "done" }] })))).toThrow("diff");
    const receipt = createReviewReceipt("owner/repo", previous)!;
    expect(receipt.complete).toBe(false);
    expect(receipt.readSections).toEqual([]);
  });

  it("loads only a submitted recognized bot review for the exact repository, PR and baseline", async () => {
    const previous = scope(); plan(previous); complete(previous);
    const check = { name: "pullfrog", head_sha: previous.scope.headSha, app: { slug: "prfrog" }, external_id: "" };
    const get = vi.fn().mockImplementation(async () => ({ data: check }));
    const update = vi.fn().mockImplementation(async (params: { external_id: string }) => { check.external_id = params.external_id; });
    const paginate = vi.fn();
    const ctx = { repo: { owner: "owner", name: "repo" }, payload: { checkRun: { id: "123" } }, octokit: { paginate, rest: { checks: { get, update }, pulls: { listReviews: vi.fn() } } } } as unknown as ToolContext;
    const receipt = (await attestReviewReceipt(ctx, createReviewReceipt("owner/repo", previous)))!;
    expect(update).toHaveBeenCalledWith({ owner: "owner", repo: "repo", check_run_id: 123, external_id: check.external_id });
    const body = appendReviewReceipt("Reviewed.", receipt);
    const good = { id: 1, user: { login: "prfrog[bot]", type: "Bot" }, state: "COMMENTED", submitted_at: "2026-09-16T16:38:00Z", commit_id: previous.scope.headSha, body };
    paginate.mockResolvedValue([good]);
    expect(await fetchReviewReceipt(ctx, 42, previous.scope.headSha)).toEqual(receipt);
    for (const bad of [
      { ...good, user: { login: "human", type: "User" } },
      { ...good, user: { login: "prfrog", type: "User" } },
      { ...good, state: "PENDING" },
      { ...good, body: appendReviewReceipt("unattested", createReviewReceipt("owner/repo", previous)) },
      { ...good, body: appendReviewReceipt("forged body", { ...receipt, readSections: [] }) },
      { ...good, commit_id: "other" },
      { ...good, body: appendReviewReceipt("wrong repo", { ...receipt, repository: "other/repo" }) },
      { ...good, body: appendReviewReceipt("wrong PR", { ...receipt, pullNumber: 43 }) },
    ]) {
      paginate.mockResolvedValue([bad]);
      expect(await fetchReviewReceipt(ctx, 42, previous.scope.headSha)).toBeUndefined();
    }
    paginate.mockResolvedValue([good]);
    for (const badCheck of [
      { ...check, external_id: "forged" },
      { ...check, head_sha: "other" },
      { ...check, name: "some other check" },
      { ...check, app: { slug: "github-actions" } },
    ]) {
      get.mockResolvedValueOnce({ data: badCheck });
      expect(await fetchReviewReceipt(ctx, 42, previous.scope.headSha)).toBeUndefined();
    }
    update.mockRejectedValueOnce(new Error("checks unavailable"));
    expect(await attestReviewReceipt(ctx, receipt)).toBeUndefined();
    expect(await attestReviewReceipt({ ...ctx, payload: { ...ctx.payload, checkRun: undefined } }, receipt)).toBeUndefined();
    paginate.mockRejectedValue(new Error("API unavailable"));
    expect(await fetchReviewReceipt(ctx, 42, previous.scope.headSha)).toBeUndefined();
  });
});
