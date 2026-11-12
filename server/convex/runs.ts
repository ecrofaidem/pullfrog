// Run bookkeeping: a row is created at dispatch, linked to its GitHub run by
// the workflow_run webhook (matched through the dispatch id in the run-name),
// and enriched by the action's own PATCHes.

import { v, type ObjectType } from "convex/values";
import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireDashboardUser } from "./auth";
import { runStatus } from "./schema";

export const recordDispatch = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    dispatchId: v.string(),
    kind: v.string(),
    trigger: v.string(),
    prNumber: v.optional(v.number()),
    prTitle: v.optional(v.string()),
    headSha: v.optional(v.string()),
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    changedFiles: v.optional(v.number()),
    triggerer: v.optional(v.string()),
    title: v.string(),
    checkRunId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Atomic reservation across webhook deliveries. A failed dispatch is retried
    // through its Actions run or a manual dispatch, never by redelivering a merge.
    if (args.kind === "docs_update") {
      const previous = await ctx.db.query("runs")
        .withIndex("by_repo_pr", (q) => q.eq("owner", args.owner).eq("repo", args.repo).eq("prNumber", args.prNumber))
        .filter((q) => q.and(q.eq(q.field("kind"), "docs_update"), q.eq(q.field("headSha"), args.headSha)))
        .first();
      if (previous) return null;
    }
    const now = Date.now();
    const id = await ctx.db.insert("runs", { ...args, status: "dispatched", createdAt: now, updatedAt: now });
    await syncRunUsage(ctx, id);
    return id;
  },
});

/** Keeps the run's runUsage mirror equal to the run, or removes it with the run. */
async function syncRunUsage(ctx: MutationCtx, id: Id<"runs">, loaded?: Doc<"runs">): Promise<void> {
  const run = loaded ?? await ctx.db.get(id);
  const existing = await ctx.db.query("runUsage").withIndex("by_run", (q) => q.eq("runId", id)).unique();
  if (!run) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const raw = {
    runId: id, owner: run.owner, repo: run.repo, createdAt: run.createdAt, completedAt: run.completedAt,
    status: run.status, kind: run.kind, prNumber: run.prNumber, prTitle: run.prTitle?.slice(0, 200), htmlUrl: run.htmlUrl,
    tokens: (run.inputTokens ?? 0) + (run.outputTokens ?? 0),
    lines: run.additions !== undefined && run.deletions !== undefined ? run.additions + run.deletions : undefined,
    codexAccountId: run.codexAccountId, quotaStartPercent: run.quotaStartPercent, quotaEndPercent: run.quotaEndPercent,
    codexSpeed: run.codexSpeed, codexSubagents: run.codexSubagents,
  };
  const row = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) as
    Omit<Doc<"runUsage">, "_id" | "_creationTime">;
  if (!existing) await ctx.db.insert("runUsage", row);
  else {
    const { _id, _creationTime, ...current } = existing;
    if (JSON.stringify(current, Object.keys(raw).sort()) !== JSON.stringify(row, Object.keys(raw).sort())) {
      await ctx.db.replace(_id, row);
    }
  }
}

/** One-off after deploy: `convex run runs:backfillRunUsage '{}'` mirrors runs that predate runUsage. */
export const backfillRunUsage = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<void> => {
    // bounded in bytes too: run documents carry summary snapshots
    const page = await ctx.db.query("runs").paginate({ cursor: args.cursor ?? null, numItems: 50, maximumBytesRead: 4_000_000 });
    for (const run of page.page) await syncRunUsage(ctx, run._id, run);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.runs.backfillRunUsage, { cursor: page.continueCursor });
  },
});

const patchableStrings = [
  "docsOutcome",
  "docsPullRequestUrl",
  "model",
  "agent",
  "credential",
  "prNodeId",
  "issueNodeId",
  "reviewNodeId",
  "planCommentNodeId",
  "summarySnapshot",
  "codexSpeed",
] as const;
/** server-derived attribution, carried with the patchable fields when an orphan row is folded in */
const attributionKeys = ["codexAccountId", "codexAttempt", "quotaStartPercent"] as const;

const patchableNumbers = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
  "codexSubagents",
  "quotaEndPercent",
] as const;

/** workflow_run webhook: attach the GitHub run to the dispatch it came from. */
const observeArgs = {
  owner: v.string(),
  repo: v.string(),
  dispatchId: v.optional(v.string()),
  githubRunId: v.number(),
  githubRunAttempt: v.optional(v.number()),
  currentAttemptVerified: v.optional(v.boolean()),
  htmlUrl: v.string(),
  title: v.string(),
  status: runStatus,
  conclusion: v.optional(v.string()),
};

export const observeWorkflowRun = internalMutation({
  args: observeArgs,
  handler: async (ctx, args) => {
    const id = await observe(ctx, args);
    if (id) await syncRunUsage(ctx, id);
    return id;
  },
});

async function observe(ctx: MutationCtx, args: ObjectType<typeof observeArgs>): Promise<Id<"runs"> | null> {
    const now = Date.now();
    const byRun = await ctx.db
      .query("runs")
      .withIndex("by_github_run", (q) => q.eq("githubRunId", args.githubRunId))
      .unique();
    const byDispatch =
      (args.dispatchId
        ? await ctx.db
            .query("runs")
            .withIndex("by_dispatch", (q) => q.eq("dispatchId", args.dispatchId))
            .unique()
        : null) ?? byRun;
    // Older rows (and callbacks arriving before the first webhook) do not tell
    // us which attempt they represent. Ask the action for current GitHub state.
    if (byDispatch && byDispatch.githubRunAttempt === undefined && !args.currentAttemptVerified) {
      return null;
    }
    const attempt = args.githubRunAttempt ?? 1;
    const previousAttempt = byDispatch?.githubRunAttempt ?? 1;
    if (attempt < previousAttempt) return byDispatch!._id;
    const terminal =
      args.status === "completed" || args.status === "failed" || args.status === "cancelled";
    const patch = {
      githubRunId: args.githubRunId,
      githubRunAttempt: attempt,
      htmlUrl: args.htmlUrl,
      status: args.status,
      ...(terminal ? { conclusion: args.conclusion } : {}),
    };
    if (byDispatch) {
      // the action's PATCHes may have landed on a row keyed only by GitHub run
      // id before we knew which dispatch it belonged to: fold that orphan in.
      if (byRun && byRun._id !== byDispatch._id) {
        const carried: Record<string, string | number> = {};
        for (const key of [...patchableStrings, ...patchableNumbers, ...attributionKeys]) {
          const value = byRun[key];
          if (value !== undefined) carried[key] = value;
        }
        await ctx.db.patch(byDispatch._id, carried);
        await ctx.db.delete(byRun._id);
        await syncRunUsage(ctx, byRun._id);
      }
      // never regress a terminal row back to in_progress from a late webhook.
      if (attempt === previousAttempt && byDispatch.completedAt && !terminal) return byDispatch._id;
      const next = {
        ...patch,
        ...(attempt > previousAttempt
          ? {
              conclusion: args.conclusion,
              completedAt: undefined,
              error: undefined,
              createdAt: now,
            }
          : {}),
      };
      if (
        Object.entries(next).some(
          ([key, value]) => byDispatch[key as keyof typeof byDispatch] !== value,
        )
      ) {
        await ctx.db.patch(byDispatch._id, {
          ...next,
          updatedAt: now,
          ...(terminal
            ? {
                completedAt:
                  byDispatch.completedAt && attempt === previousAttempt
                    ? byDispatch.completedAt
                    : now,
              }
            : {}),
        });
      }
      if (attempt > previousAttempt) await clearAttribution(ctx, byDispatch._id, attempt, previousAttempt);
      return byDispatch._id;
    }
    // a run we did not dispatch (manual workflow_dispatch from the Actions tab).
    return ctx.db.insert("runs", {
      owner: args.owner,
      repo: args.repo,
      kind: "manual",
      trigger: "workflow_dispatch",
      title: args.title,
      createdAt: now,
      ...patch,
      updatedAt: now,
      ...(terminal ? { completedAt: now } : {}),
    });
}

/**
 * a new attempt is served and measured afresh, unless its own PATCH already got
 * here first. Its token counters go too, so a rerun that never reports usage
 * does not inherit the previous attempt's tokens on the new account.
 */
async function clearAttribution(ctx: MutationCtx, id: Id<"runs">, attempt: number, untagged: number): Promise<void> {
  const run = await ctx.db.get(id);
  // figures without a tag were reported by the attempt GitHub had linked when they arrived
  if (!run || Number(run.codexAttempt ?? untagged) >= attempt) return;
  const {
    _id, _creationTime, codexAccountId, codexAttempt, quotaStartPercent, quotaEndPercent, codexSpeed, codexSubagents,
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, ...rest
  } = run;
  await ctx.db.replace(_id, rest);
}

/** The pooled account this run was activated on, and its weekly % at that moment. */
async function servingAccount(
  ctx: MutationCtx, args: { owner: string; repo: string; githubRunId: number }, minAttempt: number,
): Promise<{ codexAccountId?: Id<"codexAccounts">; codexAttempt?: string; quotaStartPercent?: number }> {
  // assignments are keyed by the lowercased scope (codexAssignments.reserve)
  const assignments = await ctx.db.query("codexAssignments")
    .withIndex("by_attempt", (q) => q.eq("owner", args.owner.trim().toLowerCase()).eq("repo", args.repo.trim().toLowerCase())
      .eq("runId", String(args.githubRunId)))
    .collect();
  const served = assignments
    .filter((a) => a.denialReason === undefined && (a.phase === "active" || a.phase === "released") &&
      Number(a.runAttempt) >= minAttempt)
    // the newest attempt wins: its PATCH can arrive before GitHub's webhook says the attempt started
    .sort((a, b) => Number(b.runAttempt) - Number(a.runAttempt) || b.createdAt - a.createdAt)[0];
  if (!served) return {};
  const start = await ctx.db.query("codexQuotaSamples")
    .withIndex("by_account_time", (q) => q.eq("accountId", served.accountId).lte("observedAt", served.createdAt + 30_000))
    .order("desc").first();
  return {
    codexAccountId: served.accountId, codexAttempt: served.runAttempt,
    ...(start ? { quotaStartPercent: start.usedPercent } : {}),
  };
}

/** PATCH /api/workflow-run/:id from the action. upserts by GitHub run id. */
export const patchFromAction = internalMutation({
  args: { owner: v.string(), repo: v.string(), githubRunId: v.number(), fields: v.any() },
  handler: async (ctx, args) => {
    const id = await applyPatch(ctx, args);
    if (id) await syncRunUsage(ctx, id);
    return id;
  },
});

async function applyPatch(
  ctx: MutationCtx, args: { owner: string; repo: string; githubRunId: number; fields: unknown },
): Promise<Id<"runs"> | null> {
    const fields = (args.fields ?? {}) as Record<string, unknown>;
    const patch: Record<string, string | number> = {};
    for (const key of patchableStrings) {
      const value = fields[key];
      if (key === "docsOutcome" && !["no_change", "published", "blocked", "failed"].includes(String(value))) continue;
      if (typeof value === "string" && value.length > 0) patch[key] = value;
    }
    for (const key of patchableNumbers) {
      const value = fields[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) patch[key] = value;
    }
    if (typeof patch.quotaEndPercent === "number" && patch.quotaEndPercent > 100) delete patch.quotaEndPercent;
    const now = Date.now();
    const found = await ctx.db
      .query("runs")
      .withIndex("by_github_run", (q) => q.eq("githubRunId", args.githubRunId))
      .unique();
    let existing = found;
    // re-resolved on every report so a retried attempt is attributed to the account it ran on
    const serving = await servingAccount(ctx, args, existing?.githubRunAttempt ?? 1);
    // a late report from an older attempt must not overwrite the newer attempt's figures
    const reported = (fields as { runAttempt?: unknown }).runAttempt;
    const newest = Math.max(existing?.githubRunAttempt ?? 1, Number(existing?.codexAttempt ?? 1), Number(serving.codexAttempt ?? 1));
    if (typeof reported === "number" && reported < newest) return existing?._id ?? null;
    // the attempt these figures belong to: the one serving, or the one reporting
    const owner = Math.max(Number(serving.codexAttempt ?? 0), typeof reported === "number" ? reported : 0);
    if (owner > 0) serving.codexAttempt = String(owner);
    // attribution moving to a newer attempt drops the older attempt's figures first
    if (existing && serving.codexAttempt !== undefined) {
      await clearAttribution(ctx, existing._id, Number(serving.codexAttempt), existing.githubRunAttempt ?? 1);
      existing = await ctx.db.get(existing._id);
    }
    Object.assign(patch, serving);
    if (existing) {
      if (
        Object.entries(patch).some(
          ([key, value]) => existing[key as keyof typeof existing] !== value,
        )
      ) {
        await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
      }
      return existing._id;
    }
    return ctx.db.insert("runs", {
      owner: args.owner,
      repo: args.repo,
      githubRunId: args.githubRunId,
      kind: "manual",
      trigger: "workflow_dispatch",
      title: `run ${args.githubRunId}`,
      status: "in_progress",
      createdAt: now,
      updatedAt: now,
      ...patch,
    });
}

export const markDispatchFailed = internalMutation({
  args: { id: v.id("runs"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    await syncRunUsage(ctx, args.id);
  },
});

const OPEN: Doc<"runs">["status"][] = ["dispatched", "queued", "in_progress"];
const STALE_GRACE_MS = 15 * 60 * 1000;

/** "1h30m" → ms; anything unparseable is treated as the action's 1h default. */
function timeoutMs(text: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return 60 * 60 * 1000;
  return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 * 1000;
}

/** cron: an open run older than the repo's timeout plus grace never reported back; say so. */
export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const repos = await ctx.db.query("repos").collect();
    const now = Date.now();
    let swept = 0;
    for (const repo of repos) {
      const cutoff = now - timeoutMs(repo.timeout) - STALE_GRACE_MS;
      const open = (
        await Promise.all(
          OPEN.map((status) =>
            ctx.db
              .query("runs")
              .withIndex("by_repo_status", (q) =>
                q
                  .eq("owner", repo.owner)
                  .eq("repo", repo.name)
                  .eq("status", status)
                  .lt("createdAt", cutoff),
              )
              .take(100),
          ),
        )
      ).flat();
      for (const run of open) {
        await ctx.db.patch(run._id, {
          status: "failed",
          conclusion: "stale",
          error: `No completion reported within ${repo.timeout} of dispatch.`,
          updatedAt: now,
          completedAt: now,
        });
        await syncRunUsage(ctx, run._id);
        swept += 1;
      }
    }
    return { swept };
  },
});

/** observed rows that never found their dispatch: kind manual, a GitHub run id, no dispatch id. */
export const orphans = internalQuery({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<Doc<"runs">[]> => {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .collect();
    return rows.filter((r) => r.kind === "manual" && r.githubRunId !== undefined && !r.dispatchId);
  },
});

/**
 * the PR head the newest full or delta review was dispatched for, so a push is reviewed as the
 * delta since then even when pushes in between were ignored. Null when the PR never had a
 * review (ignored, author allowed after opening, or rows from before heads were recorded):
 * the next push gets a full review. An in-flight run counts: it covers the head it was
 * dispatched for and the delta covers what came after, which is the coverage a push
 * mid-review always had. Counting only completed runs would dispatch a second full review
 * beside the running one.
 */
export const lastReviewedHead = internalQuery({
  args: { owner: v.string(), repo: v.string(), prNumber: v.number() },
  handler: async (ctx, args): Promise<string | null> => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_repo_pr", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("prNumber", args.prNumber)
      )
      .order("desc")
      .filter((q) =>
        q.and(
          q.or(q.eq(q.field("kind"), "review"), q.eq(q.field("kind"), "incremental_review")),
          q.neq(q.field("status"), "failed"),
          q.neq(q.field("status"), "cancelled"),
          q.neq(q.field("headSha"), undefined)
        )
      )
      .first();
    return run?.headSha ?? null;
  },
});

export const recent = internalQuery({
  args: { owner: v.string(), repo: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<Doc<"runs">[]> =>
    ctx.db
      .query("runs")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .order("desc")
      .take(args.limit),
});

// ── dashboard ────────────────────────────────────────────────────────────────

export const list = query({
  args: { owner: v.string(), repo: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"runs">[]> => {
    await requireDashboardUser(ctx);
    return ctx.db
      .query("runs")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
  },
});
