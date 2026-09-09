import { type } from "arktype";
import { primaryRepoState } from "../toolState.ts";
import { currentReviewCoverage, isCodexReview, loadReviewManifest, missingReviewPasses, planReview, recordReviewPasses, verifyGuidanceSources } from "../utils/reviewCoverage.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

export const ReviewCheckpoint = type({
  action: type.enumerated("plan", "record", "incomplete"),
  review_id: type.string.describe("Exact reviewId returned by checkout_pr; binds this record to that diff and revision."),
  "manifest_path?": type.string.describe("Governance manifest JSON built using checkout_pr's changedFilesPath."),
  "no_manifest_reason?": type.string.describe("Where you checked for repository governance tooling, if no manifest provider exists."),
  "lenses?": type({ id: type.enumerated("A", "B", "C", "D", "E", "F"), status: type.enumerated("selected", "not_applicable"), reason: "string" }).array(),
  "passes?": type({
    id: type.string.describe("A required pass ID returned by action=plan, including sweep:<manifest-check-id>."),
    status: type.enumerated("completed", "incomplete"),
    evidence: type({ reference: "string", trace: "string[]", outcome: "string" }).array(),
  }).array(),
  "reason?": type.string.describe("For action=incomplete: concrete limitation after retry, never a clean verdict."),
});

export function ReviewCheckpointTool(ctx: ToolContext) {
  return tool({
    name: "review_checkpoint",
    mutates: true,
    description: "Record internal single-session Codex review coverage. plan imports the governance manifest and requires decisions for all six lenses; record accepts evidence for completed/incomplete passes; incomplete declares a limitation when required work cannot finish. Nothing is posted to GitHub. A clean review requires all planned work and final verification.",
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
        return { reviewId: coverage.scope.id, required: coverage.plan!.required, excluded: coverage.plan!.excluded };
      }
      if (params.action === "record") {
        verifyGuidanceSources(primaryRepoState(ctx.toolState).dir, coverage.plan?.sources ?? []);
        if (!params.passes?.length) throw new Error("record needs at least one pass with evidence.");
        recordReviewPasses(coverage, params.passes);
      } else {
        if (!params.reason?.trim()) throw new Error("Explain why required review work cannot complete.");
        coverage.limitation = params.reason.trim();
      }
      return { reviewId: coverage.scope.id, remaining: missingReviewPasses(coverage), limitation: coverage.limitation ?? null };
    }),
  });
}
