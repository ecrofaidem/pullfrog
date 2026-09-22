import { type } from "arktype";
import { primaryRepoState } from "../toolState.ts";
import { currentReviewCoverage, isCodexReview, loadReviewManifest, missingReviewPasses, planReview, recordReviewPasses, verifyGuidanceSources } from "../utils/reviewCoverage.ts";
import { getDiffCoverageBreakdown } from "../utils/diffCoverage.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

export const ReviewCheckpoint = type({
  action: type.enumerated("plan", "record", "incomplete", "status"),
  review_id: type.string.describe("Exact reviewId returned by checkout_pr; binds this record to that diff and revision."),
  "manifest_path?": type.string.describe("Governance manifest JSON built using checkout_pr's changedFilesPath."),
  "no_manifest_reason?": type.string.describe("Where you checked for repository governance tooling, if no manifest provider exists."),
  "lenses?": type({ id: type.enumerated("A", "B", "C", "D", "E", "F"), status: type.enumerated("selected", "not_applicable"), reason: "string" }).array(),
  "passes?": type({
    id: type.string.describe("A required pass ID returned by action=plan, including sweep:<manifest-check-id>."),
    status: type.enumerated("completed", "incomplete"),
    evidence: type({ reference: "string", trace: "string[]", outcome: "string" }).array(),
  }).array(),
  "reason?": type.string.describe("For action=incomplete: internal failure details, recovery attempted and remaining work. Read pagination is normal progress, not a failed retry."),
  "public_summary?": type.string.describe("For action=incomplete: one short plain-language sentence naming what could not be checked and why (at most 300 characters). No checkpoint IDs or process jargon. The detailed reason stays in the run log."),
});

export function ReviewCheckpointTool(ctx: ToolContext) {
  return tool({
    name: "review_checkpoint",
    mutates: true,
    description: "Track Codex review coverage. plan imports current guidance and reusable reads from a verified prior review; status returns remaining passes and diff ranges; record saves evidence; incomplete declares a blocker after appropriate recovery. The public summary is separate from internal failure details. A clean review requires delivered diff pages, all planned passes and final verification.",
    parameters: ReviewCheckpoint,
    execute: execute(async params => {
      if (!isCodexReview(ctx)) throw new Error("Review checkpoints apply only to Codex Review/IncrementalReview mode.");
      const coverage = await currentReviewCoverage(ctx, params.review_id);
      if (params.action === "plan") {
        if (!params.lenses) throw new Error("plan needs decisions for lenses A–F.");
        if (params.manifest_path && params.no_manifest_reason) throw new Error("Supply a manifest or a no-provider reason, not both.");
        const manifest = params.manifest_path
          ? loadReviewManifest(params.manifest_path, primaryRepoState(ctx.toolState).dir, ctx.tmpdir, coverage.scope)
          : undefined;
        planReview(coverage, params.lenses, manifest, params.no_manifest_reason);
      }
      if (params.action === "record") {
        verifyGuidanceSources(primaryRepoState(ctx.toolState).dir, coverage.plan?.sources ?? []);
        if (!params.passes?.length) throw new Error("record needs at least one pass with evidence.");
        recordReviewPasses(coverage, params.passes);
      } else if (params.action === "incomplete") {
        if (!params.reason?.trim()) throw new Error("Explain why required review work cannot complete.");
        if (params.public_summary && params.public_summary.trim().length > 300) throw new Error("Keep public_summary to one plain-language sentence of at most 300 characters.");
        coverage.limitation = params.reason.trim();
        coverage.publicSummary = params.public_summary?.trim();
      }
      return {
        reviewId: coverage.scope.id,
        analysisScope: coverage.analysisScope ?? "full",
        required: coverage.plan?.required ?? [],
        excluded: coverage.plan?.excluded ?? [],
        remaining: missingReviewPasses(coverage),
        priorRemainingPasses: coverage.previousReceipt?.remainingPasses ?? [],
        reads: coverage.readCoverage?.map(state => {
          const remaining = getDiffCoverageBreakdown({ state });
          return { path: state.diffPath, unreadLines: remaining.unreadLines, ranges: remaining.unreadRanges };
        }) ?? [],
        limitation: coverage.limitation ?? null,
      };
    }),
  });
}
