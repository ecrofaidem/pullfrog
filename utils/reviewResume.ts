import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type } from "arktype";
import type { ToolContext } from "../mcp/server.ts";
import { parseCheckRunId, RUN_STATUS_CHECK_NAME } from "./runStatusCheck.ts";
import { countLines, getDiffCoverageBreakdown, recordDeliveredDiffRange, type DiffCoverageState } from "./diffCoverage.ts";
import type { ReviewCoverage } from "./reviewCoverage.ts";

const MARKER = "PULLFROG_REVIEW_COVERAGE_V1";
const RECEIPT_DIGEST_PREFIX = "pullfrog-review-coverage:";
const REVIEW_APPS = ["prfrog", "pullfrog", "pullfrogdev"];
// Leave room for the human review and its footer within GitHub's body limit.
const MAX_RECEIPT_CHARS = 24000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const Receipt = type({
  version: "1",
  repository: "string",
  pullNumber: "number.integer > 0",
  headSha: "string",
  baseSha: "string",
  sources: type({ path: "string", sha256: "string" }).array(),
  readSections: "string[]",
  complete: "boolean",
  remainingPasses: "string[]",
  "checkRunId?": "number.integer > 0",
});
export type ReviewReceipt = typeof Receipt.infer;

/** Raw Git output, not the GitHub numbered display (which can omit patches). */
export function createReviewReadState(path: string): DiffCoverageState {
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  const starts = lines.flatMap((line, index) => line.startsWith("diff --git ") ? [index] : []);
  return {
    diffPath: path,
    contentHash: hash(content),
    totalLines: countLines({ content }),
    tocEntries: starts.map((start, index) => ({
      filename: lines[start]!.slice("diff --git ".length),
      startLine: start + 1,
      endLine: starts[index + 1] ?? lines.length,
    })),
    coveredRanges: [],
    coveragePreflightRan: false,
  };
}

function sections(state: DiffCoverageState) {
  const lines = readFileSync(state.diffPath, "utf8").split("\n");
  return state.tocEntries.map(entry => ({
    ...entry,
    hash: hash(lines.slice(entry.startLine - 1, entry.endLine).join("\n")),
  }));
}

export function unreadReviewFiles(coverage: ReviewCoverage): number {
  const raw = coverage.readCoverage?.find(state => state.diffPath === coverage.scope.unifiedDiffPath);
  return raw ? getDiffCoverageBreakdown({ state: raw }).files.filter(file => file.unreadRanges.length > 0).length : 0;
}

export function hasUnreadReviewDiff(coverage: ReviewCoverage): boolean {
  return coverage.readCoverage?.some(state => getDiffCoverageBreakdown({ state }).unreadLines > 0) ?? false;
}

export function createReviewReceipt(repository: string, coverage: ReviewCoverage): ReviewReceipt | undefined {
  const raw = coverage.readCoverage?.find(state => state.diffPath === coverage.scope.unifiedDiffPath);
  if (!raw || !coverage.plan) return undefined;
  const files = getDiffCoverageBreakdown({ state: raw }).files;
  const readSections = sections(raw).filter((_, index) => files[index]!.unreadRanges.length === 0).map(file => file.hash);
  const remainingPasses = coverage.plan.required.filter(id => coverage.passes[id]?.status !== "completed");
  if (hasUnreadReviewDiff(coverage)) remainingPasses.push("diff reading");
  return {
    version: 1,
    repository,
    pullNumber: coverage.scope.pullNumber,
    headSha: coverage.scope.headSha,
    baseSha: coverage.scope.baseSha,
    sources: coverage.plan.sources,
    readSections,
    complete: remainingPasses.length === 0 && !coverage.limitation,
    remainingPasses,
  };
}

export function stripReviewReceipt(body: string): string {
  return body.replace(/<!--\s*PULLFROG_REVIEW_COVERAGE_V1\b[\s\S]*?-->/g, "").trim();
}

export function appendReviewReceipt(body: string, receipt: ReviewReceipt | undefined): string {
  const clean = stripReviewReceipt(body);
  if (!receipt) return clean;
  const encoded = Buffer.from(JSON.stringify(receipt)).toString("base64");
  // Oversized state degrades to a full review next run, never partial trust.
  if (encoded.length > MAX_RECEIPT_CHARS || clean.length + encoded.length > 60000) return clean;
  return `${clean}\n\n<!-- ${MARKER} ${encoded} -->`;
}

export function parseReviewReceipt(body: string): ReviewReceipt | undefined {
  const matches = [...body.matchAll(/^<!-- PULLFROG_REVIEW_COVERAGE_V1 ([A-Za-z0-9+/=]+) -->$/gm)];
  if (matches.length !== 1 || matches[0]![1]!.length > MAX_RECEIPT_CHARS) return undefined;
  try {
    const parsed = Receipt(JSON.parse(Buffer.from(matches[0]![1]!, "base64").toString("utf8")));
    if (parsed instanceof type.errors) return undefined;
    if (![parsed.headSha, parsed.baseSha].every(sha => /^[a-f0-9]{40,64}$/.test(sha)) ||
        !parsed.readSections.every(sha => /^[a-f0-9]{64}$/.test(sha)) ||
        !parsed.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256)) ||
        new Set(parsed.sources.map(source => source.path)).size !== parsed.sources.length ||
        (parsed.complete && parsed.remainingPasses.length > 0)) return undefined;
    return parsed;
  } catch { return undefined; }
}

const receiptDigest = (receipt: ReviewReceipt) => RECEIPT_DIGEST_PREFIX + hash(JSON.stringify(receipt));

/**
 * Anchor body bytes in the existing run check, using the harness-only checks
 * credential. Bot authorship alone is insufficient: the agent's role-mirrored
 * gh token can publish review bodies, but deliberately has no checks permission.
 * A concurrent run overwriting this digest safely disables reuse.
 */
export async function attestReviewReceipt(ctx: Pick<ToolContext, "repo" | "octokit" | "payload">, receipt: ReviewReceipt | undefined): Promise<ReviewReceipt | undefined> {
  const checkRunId = parseCheckRunId(ctx.payload.checkRun);
  if (!receipt || !checkRunId) return undefined;
  try {
    const { data: check } = await ctx.octokit.rest.checks.get({ owner: ctx.repo.owner, repo: ctx.repo.name, check_run_id: checkRunId });
    if (check.name !== RUN_STATUS_CHECK_NAME || check.head_sha !== receipt.headSha || !REVIEW_APPS.includes(check.app?.slug ?? "")) return undefined;
    const attested = { ...receipt, checkRunId };
    await ctx.octokit.rest.checks.update({ owner: ctx.repo.owner, repo: ctx.repo.name, check_run_id: checkRunId, external_id: receiptDigest(attested) });
    return attested;
  } catch {
    // Review publication remains available; missing attestation means full review next time.
    return undefined;
  }
}

/** Accept a bot review only when its bytes match harness-owned check metadata. */
export async function fetchReviewReceipt(ctx: Pick<ToolContext, "repo" | "octokit">, pullNumber: number, beforeSha: string | undefined): Promise<ReviewReceipt | undefined> {
  if (!beforeSha) return undefined;
  try {
    const reviews = await ctx.octokit.paginate(ctx.octokit.rest.pulls.listReviews, {
      owner: ctx.repo.owner, repo: ctx.repo.name, pull_number: pullNumber, per_page: 100,
    });
    const latest = reviews.filter(review => review.user?.type === "Bot" &&
      REVIEW_APPS.some(app => review.user!.login.toLowerCase() === `${app}[bot]`) &&
      review.submitted_at && ["COMMENTED", "APPROVED", "CHANGES_REQUESTED"].includes(review.state) &&
      review.commit_id === beforeSha).sort((a, b) => b.id - a.id)[0];
    if (!latest) return undefined;
    const receipt = parseReviewReceipt(latest.body);
    if (receipt?.repository !== `${ctx.repo.owner}/${ctx.repo.name}` || receipt.pullNumber !== pullNumber || receipt.headSha !== beforeSha || !receipt.checkRunId) return undefined;
    const { data: check } = await ctx.octokit.rest.checks.get({ owner: ctx.repo.owner, repo: ctx.repo.name, check_run_id: receipt.checkRunId });
    if (check.name !== RUN_STATUS_CHECK_NAME || check.head_sha !== beforeSha || !REVIEW_APPS.includes(check.app?.slug ?? "") || check.external_id !== receiptDigest(receipt)) return undefined;
    return receipt;
  } catch {
    // Missing API/state is unknown coverage. Re-read instead of failing open.
    return undefined;
  }
}

/** Called after current guidance is known. Never import old reasoning as evidence. */
export function applyReviewResume(coverage: ReviewCoverage): void {
  coverage.analysisScope = "full";
  const previous = coverage.previousReceipt;
  const sources = coverage.plan?.sources ?? [];
  const fingerprint = (items: typeof sources) => JSON.stringify([...items].sort((a, b) => a.path.localeCompare(b.path)));
  // Delivered text alone is not completed review work. A fresh full-scope
  // session needs the whole patch because prior model context is not retained.
  if (!previous?.complete || !coverage.scope.incrementalDiffPath || previous.headSha !== coverage.scope.beforeSha || previous.baseSha !== coverage.scope.baseSha ||
      !sources.length || fingerprint(sources) !== fingerprint(previous.sources)) return;
  const raw = coverage.readCoverage?.find(state => state.diffPath === coverage.scope.unifiedDiffPath);
  if (!raw) return;
  const read = new Set(previous.readSections);
  for (const section of sections(raw)) {
    if (read.has(section.hash)) recordDeliveredDiffRange({ state: raw, path: raw.diffPath, startLine: section.startLine, endLine: section.endLine });
  }
  coverage.analysisScope = "incremental";
}
