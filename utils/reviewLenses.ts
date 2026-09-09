import { formatMcpToolRef, type AgentId } from "../external.ts";

export const REVIEW_LENSES = {
  A: { name: "Control and failure signals", trigger: "Decision gates, validation, exceptions, fallbacks, or success/failure classification change.", evidence: "Trace concrete inputs and failure terminals through returned results to the downstream decision. Distinguish success, empty, partial, failed, and unknown." },
  B: { name: "Parity and propagation", trigger: "An identifier, interface, scope/filter, shared mapping, or value passed between components changes.", evidence: "Trace the authoritative producer through every affected consumer and sibling to the final sink, including defaults and transforms. Search beyond changed files." },
  C: { name: "Data semantics", trigger: "Joins, aggregation, identity spaces, pagination, migrations, RPC contracts, grants, or replay/backfill behavior change.", evidence: "Show cardinality and identity assumptions, collection completeness, and forward/replay or retry behavior for the affected contracts." },
  D: { name: "Frontend state", trigger: "Mutation handling, async data, cache keys, drafts, status rendering, listeners, or paged UI collections change.", evidence: "Trace mutations to every affected view/cache and failures to the displayed state. Check scope, races, draft baselines, and collection completeness." },
  E: { name: "Executable procedures", trigger: "CI workflows, shell commands, runnable skill procedures, or artifact handoffs change.", evidence: "Trace each prerequisite from its producer through durable storage to its first consumer, with exact runtime/cwd and failure exits. Inspect pinned tools, not an assumed current version." },
  F: { name: "Lifecycle and recovery", trigger: "State transitions, queues, checkpoints, retries, cancellation, cleanup, or resource ownership change.", evidence: "Trace entry state, durable writes, side effects, success and failure exits, retry/resume, and cleanup order. Account for coupled state and ownership on each exit." },
} as const;

export type ReviewLens = keyof typeof REVIEW_LENSES;
export const BASE_REVIEW_PASSES = ["correctness", "conventions", "documentation", "verification"] as const;

export function singleSessionReviewPrompt(agentId: AgentId): string {
  const checkpoint = formatMcpToolRef(agentId, "review_checkpoint");
  return `**Single-session review coverage.** Perform all passes yourself in this Codex session. Do not dispatch subagents or start another model session.

After reading the authoritative full diff (and the incremental delta first when supplied), load repository governance and the domain-specific review references it names. If the repository supplies a governance manifest builder, run it through the existing MCP shell sandbox with the exact \`changedFilesPath\` returned by checkout_pr, never the formatted diff or a reconstructed file list. The manifest covers the full PR for conservative guidance discovery; findings in an incremental review must still be caused or amplified by the incremental delta.

Call \`${checkpoint}\` with action=plan and checkout_pr's \`reviewId\`. Supply the manifest_path, or a concrete no_manifest_reason identifying where you checked if the repository has no provider. Decide selected/not_applicable for EVERY lens A–F, citing the risk shape in the change or a concrete exclusion reason. Select by behavior, not confidence or line count; select when uncertain. Inspect written domain rules before filling in assumptions.

${Object.entries(REVIEW_LENSES).map(([id, lens]) => `- **${id}: ${lens.name}.** Trigger: ${lens.trigger} Evidence: ${lens.evidence}`).join("\n")}

Execute the baseline correctness, conventions, and documentation passes, every selected lens, and every applicable sweep returned by the plan. Use action=record to checkpoint completed work in batches; each row names its pass ID, status, and evidence (reference, trace steps, outcome). Trace rows must name concrete code, inputs, consumers, or execution results; "checked, looks good" is not evidence. Explicitly account for nonexistent trace dimensions in the outcome. A sweep hit is a candidate: inspect documented exemptions and explain its disposition. Record failed commands as incomplete, never as an empty result. Invariants are owned by their named lint/tests; procedures and out-of-scope checks are accounted for automatically. Review changed enforcement itself for correctness without duplicating unrelated CI.

Finish with the verification pass: challenge every candidate against source, exceptions, concrete impact, and the exact causal delta; discard disproven claims and deduplicate by root cause. Include non-anchored concerns when supported. Severity depends on impact, not the lens. Zero findings needs evidence too. This is a second pass in the SAME session, not an independent review.

Before EVERY completion path, including a formatting-only incremental acknowledgement, complete the checkpoint. These obligations replace any instruction to skip deeper work: non-applicable lenses may be excluded with reasons, but baseline passes still run. If required work cannot complete, retry the failed work once, then call action=incomplete with a concrete limitation and publish a non-approving, explicitly incomplete report. The harness supplies its summary; put verified findings in inline comments. Never claim a clean result from missing coverage. A new checkout invalidates prior coverage when its scope changes. Keep detailed evidence in the run log/checkpoint; the posted review contains findings and material limitations, not the ledger.`;
}
