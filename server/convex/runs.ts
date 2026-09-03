// Run bookkeeping: a row is created at dispatch, linked to its GitHub run by
// the workflow_run webhook (matched through the dispatch id in the run-name),
// and enriched by the action's own PATCHes.

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
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
    triggerer: v.optional(v.string()),
    title: v.string(),
    checkRunId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("runs", { ...args, status: "dispatched", createdAt: now, updatedAt: now });
  },
});

const patchableStrings = [
  "model",
  "agent",
  "credential",
  "prNodeId",
  "issueNodeId",
  "reviewNodeId",
  "planCommentNodeId",
  "summarySnapshot",
] as const;
const patchableNumbers = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
] as const;

/** workflow_run webhook: attach the GitHub run to the dispatch it came from. */
export const observeWorkflowRun = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    dispatchId: v.optional(v.string()),
    githubRunId: v.number(),
    htmlUrl: v.string(),
    title: v.string(),
    status: runStatus,
    conclusion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
    const terminal = args.status === "completed" || args.status === "failed" || args.status === "cancelled";
    const patch = {
      githubRunId: args.githubRunId,
      htmlUrl: args.htmlUrl,
      status: args.status,
      ...(args.conclusion ? { conclusion: args.conclusion } : {}),
      updatedAt: now,
      ...(terminal ? { completedAt: now } : {}),
    };
    if (byDispatch) {
      // the action's PATCHes may have landed on a row keyed only by GitHub run
      // id before we knew which dispatch it belonged to: fold that orphan in.
      if (byRun && byRun._id !== byDispatch._id) {
        const carried: Record<string, string | number> = {};
        for (const key of [...patchableStrings, ...patchableNumbers]) {
          const value = byRun[key];
          if (value !== undefined) carried[key] = value;
        }
        await ctx.db.patch(byDispatch._id, carried);
        await ctx.db.delete(byRun._id);
      }
      // never regress a terminal row back to in_progress from a late webhook.
      if (byDispatch.completedAt && !terminal) return byDispatch._id;
      await ctx.db.patch(byDispatch._id, patch);
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
    });
  },
});



/** PATCH /api/workflow-run/:id from the action. upserts by GitHub run id. */
export const patchFromAction = internalMutation({
  args: { owner: v.string(), repo: v.string(), githubRunId: v.number(), fields: v.any() },
  handler: async (ctx, args) => {
    const fields = (args.fields ?? {}) as Record<string, unknown>;
    const patch: Record<string, string | number> = {};
    for (const key of patchableStrings) {
      const value = fields[key];
      if (typeof value === "string" && value.length > 0) patch[key] = value;
    }
    for (const key of patchableNumbers) {
      const value = fields[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) patch[key] = value;
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_github_run", (q) => q.eq("githubRunId", args.githubRunId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
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
  },
});

export const markDispatchFailed = internalMutation({
  args: { id: v.id("runs"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
  },
});

/** true the first time a delivery id is seen; false on GitHub's redeliveries. */
export const claimDelivery = internalMutation({
  args: { deliveryId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const seen = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    if (seen) return false;
    await ctx.db.insert("webhookDeliveries", { deliveryId: args.deliveryId, receivedAt: Date.now() });
    return true;
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
      const open = await ctx.db
        .query("runs")
        .withIndex("by_repo", (q) =>
          q.eq("owner", repo.owner).eq("repo", repo.name).lt("createdAt", cutoff)
        )
        .filter((q) => q.or(...OPEN.map((s) => q.eq(q.field("status"), s))))
        .collect();
      for (const run of open) {
        await ctx.db.patch(run._id, {
          status: "failed",
          conclusion: "stale",
          error: `No completion reported within ${repo.timeout} of dispatch.`,
          updatedAt: now,
          completedAt: now,
        });
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
