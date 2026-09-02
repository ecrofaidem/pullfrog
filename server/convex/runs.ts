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
    triggerer: v.optional(v.string()),
    title: v.string(),
    checkRunId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("runs", { ...args, status: "dispatched", createdAt: now, updatedAt: now });
  },
});

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
      byRun ??
      (args.dispatchId
        ? await ctx.db
            .query("runs")
            .withIndex("by_dispatch", (q) => q.eq("dispatchId", args.dispatchId))
            .unique()
        : null);
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
