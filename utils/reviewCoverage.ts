import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { type } from "arktype";
import type { ToolContext } from "../mcp/server.ts";
import { runSandboxed } from "../mcp/shell.ts";
import { filterEnv } from "./secrets.ts";
import { primaryRepoState } from "../toolState.ts";
import { BASE_REVIEW_PASSES, REVIEW_LENSES, type ReviewLens } from "./reviewLenses.ts";

export interface ReviewScope {
  id: string;
  pullNumber: number;
  headSha: string;
  baseSha: string;
  beforeSha?: string | undefined;
  changedFiles: string[];
  changedFilesPath: string;
  diffPath: string;
  incrementalDiffPath?: string | undefined;
}

export interface ReviewEvidence {
  reference: string;
  trace: string[];
  outcome: string;
}

export interface ReviewPass {
  id: string;
  status: "completed" | "incomplete";
  evidence: ReviewEvidence[];
}

export interface LensDecision {
  id: ReviewLens;
  status: "selected" | "not_applicable";
  reason: string;
}

export interface ReviewCoverage {
  scope: ReviewScope;
  plan?: {
    lenses: LensDecision[];
    required: string[];
    manifestHash?: string | undefined;
    sources: Array<{ path: string; sha256: string }>;
    excluded: Array<{ id: string; reason: string }>;
    noManifestReason?: string | undefined;
  };
  passes: Record<string, ReviewPass>;
  limitation?: string | undefined;
}

const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const nonempty = (value: string) => value.trim().length > 0;

export function createReviewCoverage(params: Omit<ReviewScope, "id">): ReviewCoverage {
  const scope = { ...params, changedFiles: [...new Set(params.changedFiles)].sort() };
  // JSON quoting preserves filenames containing newlines, tabs, or backslashes.
  writeFileSync(scope.changedFilesPath, scope.changedFiles.map(path => JSON.stringify(path)).join("\n") + "\n");
  return { scope: { ...scope, id: reviewScopeId(scope) }, passes: {} };
}

function reviewScopeId(scope: Omit<ReviewScope, "id">): string {
  return hash(JSON.stringify({
    ...scope,
    diff: hash(readFileSync(scope.diffPath)),
    delta: scope.incrementalDiffPath ? hash(readFileSync(scope.incrementalDiffPath)) : null,
  }));
}

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith("../") && !isAbsolute(part);
}

const Manifest = type({
  version: "2",
  changed_files: "string[]",
  instruction_files: type({ path: "string", sha256: "string" }).array(),
  mechanical_checks: type({
    id: "string",
    source: "string",
    class: type.enumerated("sweep", "invariant", "procedure", "unclassified"),
    applies_to_diff: "boolean",
    "enforced_by?": "string",
  }).array(),
});

export function loadReviewManifest(path: string, root: string, tmpdir: string, scope: ReviewScope) {
  const actual = realpathSync(path);
  if (!inside(realpathSync(root), actual) && !inside(realpathSync(tmpdir), actual)) {
    throw new Error("The manifest must be in the checkout or this run's temporary directory.");
  }
  const bytes = readFileSync(actual);
  const manifest = Manifest(JSON.parse(bytes.toString("utf8")));
  if (manifest instanceof type.errors) throw new Error("Invalid governance manifest v2.");
  if (JSON.stringify([...new Set(manifest.changed_files)].sort()) !== JSON.stringify(scope.changedFiles)) {
    throw new Error("Manifest changed_files differ from checkout_pr's scope. Rebuild with changedFilesPath.");
  }
  if (!manifest.instruction_files.length) throw new Error("Governance manifest has no instruction sources.");
  const ids = new Set<string>();
  const required: string[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  for (const check of manifest.mechanical_checks) {
    if (!nonempty(check.id) || ids.has(check.id)) throw new Error("Empty or duplicate mechanical-check ID.");
    ids.add(check.id);
    if (check.class === "unclassified") throw new Error(`Unclassified governance check: ${check.id}`);
    if (check.class === "invariant" && !check.enforced_by?.trim()) {
      throw new Error(`Invariant ${check.id} has no enforcement reference.`);
    }
    if (check.class === "sweep" && check.applies_to_diff) required.push(`sweep:${check.id}`);
    else excluded.push({ id: check.id, reason: !check.applies_to_diff ? "out_of_scope" : check.class === "invariant" ? "ci_owned" : "author_procedure" });
  }
  verifyGuidanceSources(root, manifest.instruction_files);
  return { required, excluded, sources: manifest.instruction_files, manifestHash: hash(bytes) };
}

export function verifyGuidanceSources(root: string, sources: Array<{ path: string; sha256: string }>): void {
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source.path || isAbsolute(source.path) || seen.has(source.path)) throw new Error("Invalid or duplicate guidance source.");
    seen.add(source.path);
    const path = realpathSync(resolve(root, source.path));
    if (!inside(realpathSync(root), path) || hash(readFileSync(path)) !== source.sha256) {
      throw new Error(`Guidance changed or escaped the checkout: ${source.path}. Rebuild the manifest and plan.`);
    }
  }
}

export function planReview(coverage: ReviewCoverage, lenses: LensDecision[], manifest: ReturnType<typeof loadReviewManifest> | undefined, noManifestReason?: string): void {
  const ids = lenses.map(lens => lens.id);
  if (ids.length !== Object.keys(REVIEW_LENSES).length || new Set(ids).size !== ids.length ||
      ids.some(id => !(id in REVIEW_LENSES)) || lenses.some(lens => !nonempty(lens.reason))) {
    throw new Error("Decide every lens A–F exactly once, with a concrete reason.");
  }
  if (!manifest && !noManifestReason?.trim()) throw new Error("Supply a manifest or explain where you checked for a provider.");
  coverage.plan = {
    lenses,
    required: [...BASE_REVIEW_PASSES, ...lenses.filter(lens => lens.status === "selected").map(lens => lens.id), ...(manifest?.required ?? [])],
    sources: manifest?.sources ?? [],
    excluded: manifest?.excluded ?? [],
    manifestHash: manifest?.manifestHash,
    noManifestReason,
  };
  coverage.passes = {};
  coverage.limitation = undefined;
}

export function recordReviewPasses(coverage: ReviewCoverage, passes: ReviewPass[]): void {
  if (!coverage.plan) throw new Error("Register the review plan first.");
  const ids = new Set<string>();
  for (const pass of passes) {
    if (ids.has(pass.id) || !coverage.plan.required.includes(pass.id)) throw new Error(`Unexpected or duplicate pass: ${pass.id}`);
    ids.add(pass.id);
    if (!pass.evidence.length || pass.evidence.some(row => !nonempty(row.reference) || !nonempty(row.outcome) ||
        !row.trace.length || row.trace.some(step => !nonempty(step)))) {
      throw new Error(`Pass ${pass.id} needs concrete references, trace steps, and outcomes.`);
    }
    if (["A", "B", "E", "F"].includes(pass.id) && pass.evidence.some(row => row.trace.length < 2)) {
      throw new Error(`Lens ${pass.id} needs a trace through at least two states or consumers.`);
    }
  }
  const next = { ...coverage.passes, ...Object.fromEntries(passes.map(pass => [pass.id, pass])) };
  if (next.verification?.status === "completed" && coverage.plan.required.some(id => id !== "verification" && next[id]?.status !== "completed")) {
    // A changed/incomplete earlier pass invalidates verification, rather than preserving a stale final verdict.
    if (passes.some(pass => pass.id === "verification")) throw new Error("Complete other required passes before verification.");
    delete next.verification;
  } else if (passes.some(pass => pass.id !== "verification") && !passes.some(pass => pass.id === "verification")) {
    delete next.verification;
  }
  coverage.passes = next;
  coverage.limitation = undefined;
}

export function missingReviewPasses(coverage: ReviewCoverage | undefined): string[] {
  if (!coverage) return ["checkout_pr"];
  if (!coverage.plan) return ["review plan"];
  return coverage.plan.required.filter(id => coverage.passes[id]?.status !== "completed");
}

export function isCodexReview(ctx: Pick<ToolContext, "agentId" | "toolState">): boolean {
  return ctx.agentId === "codex" && ["Review", "IncrementalReview"].includes(ctx.toolState.selectedMode ?? "");
}

export async function currentReviewCoverage(ctx: Pick<ToolContext, "toolState">, reviewId?: string): Promise<ReviewCoverage> {
  const repo = primaryRepoState(ctx.toolState);
  const coverage = repo.reviewCoverage;
  if (!coverage || coverage.scope.headSha !== repo.checkoutSha || coverage.scope.pullNumber !== repo.issueNumber ||
      (reviewId !== undefined && reviewId !== coverage.scope.id)) {
    throw new Error("Review scope is missing or stale. Call checkout_pr and plan against its reviewId.");
  }
  // Reuse the restricted execution boundary: repository Git configuration can
  // invoke helpers. Disable fsmonitor and inspect submodules regardless of ignore settings.
  const checked = await runSandboxed({
    command: "git -c core.fsmonitor=false rev-parse HEAD && git -c core.fsmonitor=false diff --quiet --no-ext-diff --no-textconv --ignore-submodules=none HEAD --",
    cwd: repo.dir,
    env: filterEnv(),
    timeout: 30_000,
  });
  if (checked.timedOut || checked.exitCode !== 0) {
    throw new Error("Tracked checkout content changed or could not be verified. Restore the reviewed revision before recording or publishing coverage.");
  }
  if (checked.output.trim() !== coverage.scope.headSha) throw new Error("Checkout HEAD changed; repeat checkout_pr and the review plan.");
  const { id, ...scope } = coverage.scope;
  if (reviewScopeId(scope) !== id) throw new Error("Review diff artifacts changed; repeat checkout_pr and the review plan.");
  return coverage;
}

/** Publication is the enforcement boundary; records establish coverage, not proof of correct reasoning. */
export async function reviewCompletionBody(ctx: Pick<ToolContext, "agentId" | "toolState">, body: string, approved = false): Promise<string> {
  if (!isCodexReview(ctx)) return body;
  const coverage = await currentReviewCoverage(ctx);
  verifyGuidanceSources(primaryRepoState(ctx.toolState).dir, coverage.plan?.sources ?? []);
  const missing = missingReviewPasses(coverage);
  if (!missing.length && !coverage.limitation) return body;
  if (!coverage.limitation) throw new Error(`Review coverage incomplete: ${missing.join(", ")}. Complete review_checkpoint or explicitly record action=incomplete.`);
  if (approved) {
    throw new Error("Incomplete coverage cannot approve or claim a clean result. Report the limitation and verified findings.");
  }
  // The harness owns the incomplete disposition. Verified findings can still
  // be submitted as inline comments, but arbitrary summary text cannot override it.
  return `> [!IMPORTANT]\n> Review incomplete: ${coverage.limitation.replaceAll("\n", " ")}\n\nNo clean verdict was reached.`;
}

export async function incompleteReviewIssue(toolState: ToolContext["toolState"]): Promise<string | undefined> {
  if (toolState.agent !== "codex" || !["Review", "IncrementalReview"].includes(toolState.selectedMode ?? "")) return undefined;
  const coverage = primaryRepoState(toolState).reviewCoverage;
  if (!coverage) return "Review coverage incomplete: checkout_pr. Retry checkout_pr before planning review coverage.";
  try {
    await currentReviewCoverage({ toolState });
    verifyGuidanceSources(primaryRepoState(toolState).dir, coverage.plan?.sources ?? []);
    const missing = missingReviewPasses(coverage);
    return missing.length && !coverage.limitation ? `Review coverage incomplete: ${missing.join(", ")}. Use review_checkpoint to finish or explicitly declare the limitation.` : undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Review scope could not be verified.";
  }
}


/** Recheck GitHub as well as local artifacts before any completion is published. */
export async function reviewPublicationBody(ctx: Pick<ToolContext, "agentId" | "toolState" | "octokit" | "repo">, body: string, pullNumber: number | undefined, approved = false): Promise<string> {
  if (!isCodexReview(ctx)) return body;
  const coverage = await currentReviewCoverage(ctx);
  const repo = primaryRepoState(ctx.toolState);
  if (pullNumber !== coverage.scope.pullNumber || repo.owner !== ctx.repo.owner || repo.name !== ctx.repo.name) {
    throw new Error("Publication target differs from the checked-out PR. Call checkout_pr for this target first.");
  }
  const { data: pr } = await ctx.octokit.rest.pulls.get({ owner: ctx.repo.owner, repo: ctx.repo.name, pull_number: coverage.scope.pullNumber });
  if (pr.head.sha !== coverage.scope.headSha || pr.base.sha !== coverage.scope.baseSha) {
    throw new Error("The remote PR revision changed during review. Repeat checkout_pr and the review plan before publishing.");
  }
  return reviewCompletionBody(ctx, body, approved);
}
