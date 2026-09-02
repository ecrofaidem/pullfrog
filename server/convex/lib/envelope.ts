// The JSON envelope the action accepts in place of a plain prompt. Shape is
// action/utils/payload.ts `JsonPayload`; event shapes are action/external.ts
// `PayloadEvent`. Anything not listed there is ignored by the action, and
// `authorPermission` on the event is what decides the run's shell tier.

import type { AuthorPermission } from "./github";

export type ReviewTrigger =
  | "pull_request_opened"
  | "pull_request_ready_for_review"
  | "pull_request_synchronize"
  | "issue_comment_created";

export interface ReviewEventInput {
  trigger: ReviewTrigger;
  prNumber: number;
  title: string;
  body: string | null;
  branch: string;
  authorPermission: AuthorPermission;
  /** synchronize only */
  beforeSha?: string;
  /** issue_comment_created only */
  commentId?: number;
}

export function buildReviewEvent(input: ReviewEventInput): Record<string, unknown> {
  const base = {
    trigger: input.trigger,
    issue_number: input.prNumber,
    is_pr: true,
    title: input.title,
    body: input.body,
    branch: input.branch,
    authorPermission: input.authorPermission,
  };
  if (input.trigger === "pull_request_synchronize") {
    return { ...base, before_sha: input.beforeSha ?? "" };
  }
  if (input.trigger === "issue_comment_created") {
    return { ...base, comment_id: input.commentId ?? 0, comment_type: "issue" };
  }
  return base;
}

export interface EnvelopeInput {
  version: string;
  prompt: string;
  triggerer: string;
  event: Record<string, unknown>;
  timeout: string;
  checkRunId?: number;
}

export function buildEnvelope(input: EnvelopeInput): Record<string, unknown> {
  return {
    "~pullfrog": true,
    version: input.version,
    prompt: input.prompt,
    triggerer: input.triggerer,
    event: input.event,
    timeout: input.timeout,
    generateSummary: false,
    ...(input.checkRunId !== undefined ? { checkRun: { id: String(input.checkRunId) } } : {}),
  };
}
