// Turns GitHub webhook events into action runs. Review policy lives here:
// which PRs get reviewed, who may summon the bot by comment, and what the
// action is told about the event.

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { actionWorkflow, resolveActionVersion } from "./actionVersion";
import { buildEnvelope, buildReviewEvent, type ReviewTrigger } from "./lib/envelope";
import {
  addReaction,
  collaboratorPermission,
  createCheckRun,
  createInstallationToken,
  dispatchWorkflow,
  finalizeCheckRun,
  findRepoInstallation,
  getPullRequest,
} from "./lib/github";

/** the check-run name the action finalizes; it is also what branch protection matches on. */
const RUN_STATUS_CHECK_NAME = "pullfrog";

type Json = Record<string, any>;

export const handleEvent = internalAction({
  args: { event: v.string(), delivery: v.string(), payload: v.any() },
  handler: async (ctx, args) => {
    const payload = args.payload as Json;
    switch (args.event) {
      case "installation":
        return handleInstallation(ctx, payload);
      case "installation_repositories":
        return handleInstallationRepositories(ctx, payload);
      case "pull_request":
        return handlePullRequest(ctx, payload);
      case "issue_comment":
        return handleIssueComment(ctx, payload);
      case "workflow_run":
        return handleWorkflowRun(ctx, payload);
      default:
        return;
    }
  },
});

// ── installation bookkeeping ─────────────────────────────────────────────────

async function recordInstallationFromPayload(ctx: ActionCtx, payload: Json): Promise<string> {
  const installation = payload.installation as Json;
  const owner = String(installation.account?.login ?? "");
  await ctx.runMutation(internal.repos.recordInstallation, {
    owner,
    installationId: Number(installation.id),
    isOrg: installation.account?.type === "Organization",
    repositorySelection: String(installation.repository_selection ?? "selected"),
    suspended: Boolean(installation.suspended_at),
  });
  return owner;
}

async function enableRepos(ctx: ActionCtx, owner: string, repos: Json[], enabled: boolean) {
  for (const repo of repos) {
    const name = String(repo.name ?? repo.full_name?.split("/")[1] ?? "");
    if (!name) continue;
    if (enabled) await ctx.runMutation(internal.repos.ensure, { owner, name });
    await ctx.runMutation(internal.repos.setEnabled, { owner, name, enabled });
  }
}

async function handleInstallation(ctx: ActionCtx, payload: Json) {
  const owner = String(payload.installation?.account?.login ?? "");
  if (payload.action === "deleted") {
    await ctx.runMutation(internal.repos.removeInstallation, { owner });
    await enableRepos(ctx, owner, (payload.repositories as Json[]) ?? [], false);
    return;
  }
  await recordInstallationFromPayload(ctx, payload);
  if (payload.action === "created") {
    await enableRepos(ctx, owner, (payload.repositories as Json[]) ?? [], true);
  }
}

async function handleInstallationRepositories(ctx: ActionCtx, payload: Json) {
  const owner = await recordInstallationFromPayload(ctx, payload);
  await enableRepos(ctx, owner, (payload.repositories_added as Json[]) ?? [], true);
  await enableRepos(ctx, owner, (payload.repositories_removed as Json[]) ?? [], false);
}

// ── review policy ────────────────────────────────────────────────────────────

function isBot(user: Json | undefined): boolean {
  if (!user) return true;
  return user.type === "Bot" || String(user.login ?? "").endsWith("[bot]");
}

function authorAllowed(repo: Doc<"repos">, login: string): boolean {
  if (repo.reviewAuthorsMode === "all") return true;
  return repo.reviewAuthors.includes(login.toLowerCase());
}

function mentionRegex(handle: string): RegExp {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)@${escaped}\\s+review\\b`, "i");
}

async function repoFor(ctx: ActionCtx, payload: Json): Promise<Doc<"repos"> | null> {
  const repository = payload.repository as Json;
  const owner = String(repository.owner?.login ?? "");
  const name = String(repository.name ?? "");
  if (!owner || !name) return null;
  const repo = await ctx.runMutation(internal.repos.ensure, {
    owner,
    name,
    defaultBranch: String(repository.default_branch ?? "main"),
  });
  return repo.enabled ? repo : null;
}

async function handlePullRequest(ctx: ActionCtx, payload: Json) {
  const action = String(payload.action);
  const triggers: Record<string, ReviewTrigger> = {
    opened: "pull_request_opened",
    ready_for_review: "pull_request_ready_for_review",
    synchronize: "pull_request_synchronize",
  };
  const trigger = triggers[action];
  if (!trigger) return;

  const repo = await repoFor(ctx, payload);
  if (!repo) return;
  const pr = payload.pull_request as Json;
  if (pr.draft) return;
  if (isBot(pr.user)) return;
  if (!authorAllowed(repo, String(pr.user.login))) return;
  if (trigger === "pull_request_synchronize" && !repo.reviewOnSynchronize) return;

  const number = Number(pr.number);
  const prompt =
    trigger === "pull_request_synchronize"
      ? `New commits were pushed to pull request #${number}. Review the changes since the previous review.`
      : `Review pull request #${number}.`;

  await dispatchReview(ctx, {
    repo,
    trigger,
    kind: trigger === "pull_request_synchronize" ? "incremental_review" : "review",
    pr: {
      number,
      title: String(pr.title ?? ""),
      body: (pr.body as string | null) ?? null,
      headRef: String(pr.head?.ref ?? ""),
      headSha: String(pr.head?.sha ?? ""),
    },
    triggerer: String(payload.sender?.login ?? pr.user.login),
    prompt,
    ...(trigger === "pull_request_synchronize" ? { beforeSha: String(payload.before ?? "") } : {}),
  });
}

async function handleIssueComment(ctx: ActionCtx, payload: Json) {
  if (payload.action !== "created") return;
  const issue = payload.issue as Json;
  if (!issue?.pull_request) return;
  const comment = payload.comment as Json;
  if (isBot(comment.user)) return;

  const repo = await repoFor(ctx, payload);
  if (!repo) return;
  if (!mentionRegex(repo.handle).test(String(comment.body ?? ""))) return;

  const installation = await findRepoInstallation(repo.owner, repo.name);
  if (!installation) return;
  const token = (await createInstallationToken(installation.id, { repositories: [repo.name] })).token;

  const commenter = String(comment.user.login);
  const permission = await collaboratorPermission({
    token,
    owner: repo.owner,
    repo: repo.name,
    login: commenter,
  });
  if (!["admin", "maintain", "write"].includes(permission)) return;

  const number = Number(issue.number);
  const pr = await getPullRequest({ token, owner: repo.owner, repo: repo.name, number });
  if (pr.draft) return;

  await addReaction({
    token,
    owner: repo.owner,
    repo: repo.name,
    commentId: Number(comment.id),
    content: "eyes",
  }).catch(() => undefined);

  await dispatchReview(ctx, {
    repo,
    trigger: "issue_comment_created",
    kind: "review",
    pr: {
      number,
      title: pr.title,
      body: pr.body,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
    },
    triggerer: commenter,
    prompt: `Review pull request #${number}, as requested in the comment below.\n\n${String(comment.body ?? "")}`,
    commentId: Number(comment.id),
    token,
    authorPermission: permission,
  });
}

// ── dispatch ─────────────────────────────────────────────────────────────────

interface DispatchReviewParams {
  repo: Doc<"repos">;
  trigger: ReviewTrigger;
  kind: string;
  pr: { number: number; title: string; body: string | null; headRef: string; headSha: string };
  triggerer: string;
  prompt: string;
  beforeSha?: string;
  commentId?: number;
  /** already-minted installation token and resolved permission, when the caller has them */
  token?: string;
  authorPermission?: Awaited<ReturnType<typeof collaboratorPermission>>;
}

async function dispatchReview(ctx: ActionCtx, params: DispatchReviewParams) {
  const { repo, pr } = params;
  let token = params.token;
  if (!token) {
    const installation = await findRepoInstallation(repo.owner, repo.name);
    if (!installation) {
      console.error(`no installation for ${repo.owner}/${repo.name}; cannot dispatch`);
      return;
    }
    token = (await createInstallationToken(installation.id, { repositories: [repo.name] })).token;
  }
  const authorPermission =
    params.authorPermission ??
    (await collaboratorPermission({
      token,
      owner: repo.owner,
      repo: repo.name,
      login: params.triggerer,
    }));

  const dispatchId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const title = `${repo.handle}: review #${pr.number} · ${dispatchId}`;

  let checkRunId: number | undefined;
  if (repo.statusChecks && pr.headSha) {
    try {
      checkRunId = (
        await createCheckRun({
          token,
          owner: repo.owner,
          repo: repo.name,
          name: RUN_STATUS_CHECK_NAME,
          headSha: pr.headSha,
        })
      ).id;
    } catch (err) {
      console.warn(`check-run creation failed, continuing without: ${String(err)}`);
    }
  }

  const version = await resolveActionVersion(ctx);
  const event = buildReviewEvent({
    trigger: params.trigger,
    prNumber: pr.number,
    title: pr.title,
    body: pr.body,
    branch: pr.headRef,
    authorPermission,
    ...(params.beforeSha !== undefined ? { beforeSha: params.beforeSha } : {}),
    ...(params.commentId !== undefined ? { commentId: params.commentId } : {}),
  });
  const envelope = buildEnvelope({
    version,
    prompt: params.prompt,
    triggerer: params.triggerer,
    event,
    timeout: repo.timeout,
    ...(checkRunId !== undefined ? { checkRunId } : {}),
  });

  const runId = await ctx.runMutation(internal.runs.recordDispatch, {
    owner: repo.owner,
    repo: repo.name,
    dispatchId,
    kind: params.kind,
    trigger: params.trigger,
    prNumber: pr.number,
    prTitle: pr.title,
    triggerer: params.triggerer,
    title,
    ...(checkRunId !== undefined ? { checkRunId } : {}),
  });

  try {
    await dispatchWorkflow({
      token,
      owner: repo.owner,
      repo: repo.name,
      workflow: actionWorkflow(),
      ref: repo.defaultBranch,
      inputs: { prompt: JSON.stringify(envelope), name: title },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.runMutation(internal.runs.markDispatchFailed, { id: runId, error: message });
    if (checkRunId !== undefined) {
      await finalizeCheckRun({
        token,
        owner: repo.owner,
        repo: repo.name,
        checkRunId,
        conclusion: "failure",
        summary: `workflow_dispatch failed: ${message}`,
      }).catch(() => undefined);
    }
    throw err;
  }
}

// ── run lifecycle from workflow_run events ───────────────────────────────────

async function handleWorkflowRun(ctx: ActionCtx, payload: Json) {
  const run = payload.workflow_run as Json;
  const path = String(run?.path ?? "");
  if (!path.endsWith(`/${actionWorkflow()}`)) return;

  const repository = payload.repository as Json;
  const title = String(run.display_title ?? run.name ?? "");
  const dispatchId = /· ([a-z0-9]{8})$/.exec(title)?.[1];

  const action = String(payload.action);
  const conclusion = run.conclusion ? String(run.conclusion) : undefined;
  const status =
    action === "completed"
      ? conclusion === "success"
        ? "completed"
        : conclusion === "cancelled"
          ? "cancelled"
          : "failed"
      : action === "in_progress"
        ? "in_progress"
        : "queued";

  await ctx.runMutation(internal.runs.observeWorkflowRun, {
    owner: String(repository.owner?.login ?? ""),
    repo: String(repository.name ?? ""),
    ...(dispatchId ? { dispatchId } : {}),
    githubRunId: Number(run.id),
    htmlUrl: String(run.html_url ?? ""),
    title,
    status,
    ...(conclusion ? { conclusion } : {}),
  });
}
