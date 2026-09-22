import { v } from "convex/values";
import { isFreshCodexQuota, probeCodexQuota, type CodexQuotaObservation, type CodexQuotaResult } from "../../utils/codexQuota";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { open, timingSafeEqual } from "./lib/crypto";
import { codexQuotaResult } from "./schema";
import { internal } from "./_generated/api";
import { parseCodexAuthBody } from "./lib/codexOAuth";

const fence = {
  accountId: v.id("codexAccounts"), generation: v.number(), credentialVersion: v.number(),
  assignmentId: v.optional(v.string()), ownershipToken: v.optional(v.string()),
};

function mayObserve(row: Doc<"codexAccounts"> | null, args: {
  generation: number; credentialVersion: number; assignmentId?: string | undefined; ownershipToken?: string | undefined;
}): row is Doc<"codexAccounts"> {
  if (!row || row.generation !== args.generation || row.credentialVersion !== args.credentialVersion) return false;
  if (args.assignmentId === undefined && args.ownershipToken === undefined) {
    return row.activeAssignmentId === undefined && row.activeOwnershipToken === undefined;
  }
  return args.assignmentId !== undefined && args.ownershipToken !== undefined &&
    row.activeAssignmentId === args.assignmentId && row.activeOwnershipToken !== undefined &&
    timingSafeEqual(row.activeOwnershipToken, args.ownershipToken);
}

/** Internal only: no ciphertext, provider identity, labels, or ownership tokens. */
export const cached = internalQuery({
  args: fence,
  handler: async (ctx, args): Promise<CodexQuotaObservation | null> => {
    const row = await ctx.db.get(args.accountId);
    if (!mayObserve(row, args)) return null;
    const observation = await ctx.db.query("codexQuotaObservations")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId)).unique();
    if (!isFreshCodexQuota(observation, args) || !observation) return null;
    return {
      generation: observation.generation, credentialVersion: observation.credentialVersion,
      observedAt: observation.observedAt, result: observation.result,
    };
  },
});

/** observedAt is the probe start, so delayed reads cannot overwrite newer evidence. */
export const record = internalMutation({
  args: { ...fence, observedAt: v.number(), result: codexQuotaResult },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.get(args.accountId);
    if (!mayObserve(row, args) || !Number.isFinite(args.observedAt) || args.observedAt > Date.now()) return false;
    const existing = await ctx.db.query("codexQuotaObservations")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId)).unique();
    if (existing && existing.observedAt > args.observedAt) return false;
    const observation = {
      accountId: args.accountId, generation: args.generation, credentialVersion: args.credentialVersion,
      observedAt: args.observedAt, result: args.result,
    };
    if (existing) await ctx.db.replace(existing._id, observation);
    else await ctx.db.insert("codexQuotaObservations", observation);
    return true;
  },
});

/** Idle named chains belonging to an explicitly enabled pool; never legacy secrets. */
export const idleAccounts = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"codexAccounts">[]> => {
    const pools = await ctx.db.query("codexPools").collect();
    const ids = new Set(pools.filter((pool) => pool.enabled).flatMap((pool) => pool.accountIds));
    const rows: Doc<"codexAccounts">[] = [];
    for (const id of ids) {
      const row = await ctx.db.get(id);
      if (row?.enabled && row.authState === "ready" &&
          row.activeAssignmentId === undefined && row.activeOwnershipToken === undefined) rows.push(row);
    }
    return rows;
  },
});

/** Usage reads only. OAuth rotation belongs exclusively to the reserved runner chain. */
export const refreshIdle = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const rows = await ctx.runQuery(internal.codexQuota.idleAccounts, {});
    for (const row of rows) {
      const identity = { accountId: row._id, generation: row.generation, credentialVersion: row.credentialVersion };
      if (await ctx.runQuery(internal.codexQuota.cached, identity)) continue;
      const observedAt = Date.now();
      let result: CodexQuotaResult;
      try {
        const body = parseCodexAuthBody(await open(row));
        result = !body || body.refresh_rejected_at
          ? { status: "authentication" }
          : await probeCodexQuota({ accessToken: body.tokens.access_token, accountId: row.providerAccountId, deadline: observedAt + 10_000 });
      } catch {
        result = { status: "unknown", reason: "malformed" };
      }
      await ctx.runMutation(internal.codexQuota.record, { ...identity, observedAt, result });
    }
  },
});
