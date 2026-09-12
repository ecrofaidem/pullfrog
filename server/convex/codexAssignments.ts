import { v } from "convex/values";
import { internalAction, internalQuery, internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { timingSafeEqual } from "./lib/crypto";
import { isFreshCodexQuota } from "../../utils/codexQuota";
import { codexDenialReason } from "./schema";
import { internal } from "./_generated/api";
import { createInstallationToken, findRepoInstallation, getWorkflowRun } from "./lib/github";

export type Denial = { status: "denied"; reason: "busy" | "exhausted" | "authentication" | "configuration" | "unknown"; retryAt?: number };
type Reservation = Denial | { status: "reserved" | "active"; assignment: Doc<"codexAssignments">; account: Doc<"codexAccounts"> };
const fence = { assignmentId: v.id("codexAssignments"), ownershipToken: v.string(), generation: v.number(), credentialVersion: v.number() };
type Fence = { assignmentId: Id<"codexAssignments">; ownershipToken: string; generation: number; credentialVersion: number };

async function owned(ctx: MutationCtx, args: Fence) {
  const assignment = await ctx.db.get(args.assignmentId);
  if (!assignment || !timingSafeEqual(assignment.ownershipToken, args.ownershipToken) ||
      assignment.generation !== args.generation || assignment.credentialVersion !== args.credentialVersion) return null;
  const account = await ctx.db.get(assignment.accountId);
  if (!account || account.activeAssignmentId !== assignment._id ||
      !account.activeOwnershipToken || !timingSafeEqual(account.activeOwnershipToken, args.ownershipToken) ||
      account.generation !== args.generation || account.credentialVersion !== args.credentialVersion) return null;
  return { assignment, account };
}

async function member(ctx: MutationCtx, assignment: Doc<"codexAssignments">, account: Doc<"codexAccounts">) {
  const pool = await ctx.db.query("codexPools").withIndex("by_repo", (q) => q.eq("owner", assignment.owner).eq("repo", assignment.repo)).unique();
  return pool?.enabled && pool.accountIds.includes(account._id) && account.enabled && account.authState === "ready" &&
    account.owner === assignment.owner && (account.repo === null || account.repo === assignment.repo);
}

/** One transaction owns both the verified attempt and the canonical account. */
export const reserve = internalMutation({
  args: {
    owner: v.string(), repo: v.string(), runId: v.string(), runAttempt: v.string(), runtimeInstance: v.string(),
    ownershipToken: v.string(), excludedIds: v.array(v.id("codexAccounts")),
  },
  handler: async (ctx, input): Promise<Reservation> => {
    const args = { ...input, owner: input.owner.trim().toLowerCase(), repo: input.repo.trim().toLowerCase() };
    const existing = await ctx.db.query("codexAssignments").withIndex("by_attempt", (q) =>
      q.eq("owner", args.owner).eq("repo", args.repo).eq("runId", args.runId).eq("runAttempt", args.runAttempt)).order("desc").first();
    if (existing) {
      if (existing.finalizationStatus) return { status: "denied", reason: "configuration" };
      if (existing.runtimeInstance !== args.runtimeInstance) return { status: "denied", reason: "configuration" };
      if (existing.phase === "active") {
        const account = await ctx.db.get(existing.accountId);
        if (!account || account.generation !== existing.generation || account.credentialVersion !== existing.credentialVersion ||
            account.activeAssignmentId !== existing._id || account.activeOwnershipToken !== existing.ownershipToken ||
            !await member(ctx, existing, account)) return { status: "denied", reason: "configuration" };
        return { status: "active", assignment: existing, account };
      }
      // Only this in-flight invocation may skip a candidate; quarantines keep their own durable row.
      if ((existing.phase !== "released" && existing.phase !== "quarantined") || !timingSafeEqual(existing.ownershipToken, args.ownershipToken)) {
        return { status: "denied", reason: existing.denialReason ?? "unknown", ...(existing.retryAt === undefined ? {} : { retryAt: existing.retryAt }) };
      }
    }
    const pool = await ctx.db.query("codexPools").withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo)).unique();
    if (!pool?.enabled || !pool.accountIds.length) return { status: "denied", reason: "configuration" };
    const reasons: Denial["reason"][] = [];
    const resets: number[] = [];
    for (const [index, accountId] of pool.accountIds.entries()) {
      const account = await ctx.db.get(accountId);
      if (!account || account.owner !== args.owner || (account.repo !== null && account.repo !== args.repo) || !account.enabled) {
        reasons.push("configuration"); continue;
      }
      if (account.activeAssignmentId) { reasons.push(args.excludedIds.includes(accountId) ? "unknown" : "busy"); continue; }
      if (account.authState !== "ready") { reasons.push("authentication"); continue; }
      const quota = await ctx.db.query("codexQuotaObservations").withIndex("by_account", (q) => q.eq("accountId", accountId)).unique();
      // A cached 401 may only mean the access token expired; reserve its refresh chain once.
      if (isFreshCodexQuota(quota, account) && quota && quota.result.status !== "available" &&
          (quota.result.status !== "authentication" || args.excludedIds.includes(accountId))) {
        const reason = quota.result.status === "exhausted" ? "exhausted" : quota.result.status === "authentication" ? "authentication" : "unknown";
        reasons.push(reason);
        if (quota.result.status === "exhausted") resets.push(quota.result.weekly.resetAt);
        continue;
      }
      if (args.excludedIds.includes(accountId)) { reasons.push("unknown"); continue; }
      const now = Date.now();
      const value = {
        owner: args.owner, repo: args.repo, runId: args.runId, runAttempt: args.runAttempt,
        runtimeInstance: args.runtimeInstance, ownershipToken: args.ownershipToken, accountId,
        generation: account.generation, credentialVersion: account.credentialVersion,
        accountAlias: `Account ${index + 1}`, phase: "reserved" as const, updatedAt: now,
      };
      const reusable = existing?.phase === "released" ? existing : null;
      const assignmentId = reusable?._id ?? await ctx.db.insert("codexAssignments", { ...value, createdAt: now });
      if (reusable) await ctx.db.patch(assignmentId, { ...value, denialReason: undefined, retryAt: undefined });
      await ctx.db.patch(accountId, { activeAssignmentId: assignmentId, activeOwnershipToken: args.ownershipToken, updatedAt: now });
      return { status: "reserved", assignment: (await ctx.db.get(assignmentId))!, account };
    }
    const reason = reasons.includes("busy") ? "busy" : reasons.includes("unknown") ? "unknown" :
      reasons.includes("authentication") ? "authentication" : reasons.includes("configuration") ? "configuration" : "exhausted";
    return { status: "denied", reason, ...(reason === "exhausted" && resets.length ? { retryAt: Math.min(...resets) } : {}) };
  },
});

export const refreshStarted = internalMutation({
  args: fence,
  handler: async (ctx, args): Promise<boolean> => {
    const state = await owned(ctx, args);
    if (!state || state.assignment.phase !== "reserved" || !await member(ctx, state.assignment, state.account)) return false;
    await ctx.db.patch(args.assignmentId, { phase: "refreshing", updatedAt: Date.now() });
    return true;
  },
});

/** Rotated credentials and their durable progress marker commit together. */
export const commitRefresh = internalMutation({
  args: { ...fence, providerAccountId: v.string(), ciphertext: v.string(), iv: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const state = await owned(ctx, args);
    if (!state || state.assignment.phase !== "refreshing" || state.account.providerAccountId !== args.providerAccountId) return false;
    const now = Date.now();
    await ctx.db.patch(state.account._id, { ciphertext: args.ciphertext, iv: args.iv, credentialVersion: args.credentialVersion + 1, authState: "ready", updatedAt: now });
    await ctx.db.patch(args.assignmentId, { phase: "reserved", credentialVersion: args.credentialVersion + 1, updatedAt: now });
    return true;
  },
});

export const activate = internalMutation({
  args: fence,
  handler: async (ctx, args): Promise<boolean> => {
    const state = await owned(ctx, args);
    if (!state || state.assignment.phase !== "reserved" || !await member(ctx, state.assignment, state.account)) return false;
    const quota = await ctx.db.query("codexQuotaObservations").withIndex("by_account", (q) => q.eq("accountId", state.account._id)).unique();
    if (!quota || !isFreshCodexQuota(quota, state.account) || quota.result.status !== "available" || quota.result.weekly.usedPercent >= 100) return false;
    await ctx.db.patch(args.assignmentId, { phase: "active", updatedAt: Date.now() });
    return true;
  },
});

/** Startup only: never release active handoff or unconfirmed token rotation. */
export const abandon = internalMutation({
  args: { ...fence, reason: codexDenialReason, retryAt: v.optional(v.number()), rejected: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<void> => {
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || !timingSafeEqual(assignment.ownershipToken, args.ownershipToken) ||
        assignment.generation !== args.generation || assignment.credentialVersion !== args.credentialVersion ||
        (assignment.phase !== "reserved" && assignment.phase !== "refreshing")) return;
    const state = await owned(ctx, args);
    const uncertain = assignment.phase === "refreshing" && !args.rejected;
    const now = Date.now();
    await ctx.db.patch(assignment._id, {
      phase: uncertain ? "quarantined" : "released", denialReason: args.reason,
      ...(state && (uncertain || args.rejected) ? { credentialVersion: args.credentialVersion + 1 } : {}),
      ...(args.retryAt === undefined ? {} : { retryAt: args.retryAt }), updatedAt: now,
    });
    if (state) {
      await ctx.db.patch(state.account._id, {
        ...(uncertain || args.rejected ? { authState: uncertain ? "uncertain" as const : "rejected" as const, credentialVersion: args.credentialVersion + 1 } : {}),
        ...(!uncertain ? { activeAssignmentId: undefined, activeOwnershipToken: undefined } : {}), updatedAt: now,
      });
    } else if (!uncertain) {
      // Replacement retains occupancy; safe preflight cancellation may release it without touching new credentials.
      const account = await ctx.db.get(assignment.accountId);
      if (account?.activeAssignmentId === assignment._id && account.activeOwnershipToken === args.ownershipToken) {
        await ctx.db.patch(account._id, { activeAssignmentId: undefined, activeOwnershipToken: undefined, updatedAt: now });
      }
    }
  },
});

const capabilityArgs = { assignmentId: v.string(), ownershipToken: v.string() };
type Receipt = { status: "released" | "quarantined" | "stale" };

/** Capability lookup is internal: the runtime receives only the final receipt. */
export const finalizationState = internalQuery({
  args: capabilityArgs,
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("codexAssignments", args.assignmentId);
    const assignment = id ? await ctx.db.get(id) : null;
    if (!assignment || !timingSafeEqual(assignment.ownershipToken, args.ownershipToken)) return null;
    return { assignment, account: await ctx.db.get(assignment.accountId) };
  },
});

/** Commit the last token state and release occupancy in the same transaction. */
async function finish(ctx: MutationCtx, assignment: Doc<"codexAssignments">, auth:
  | { kind: "snapshot"; ciphertext: string; iv: string; providerAccountId: string }
  | { kind: "unchanged" }
  | { kind: "uncertain" },
): Promise<Receipt> {
  if (assignment.finalizationStatus) return { status: assignment.finalizationStatus };
  const account = await ctx.db.get(assignment.accountId);
  const occupies = account?.activeAssignmentId === assignment._id && !!account.activeOwnershipToken &&
    timingSafeEqual(account.activeOwnershipToken, assignment.ownershipToken);
  const current = occupies && account.generation === assignment.generation;
  const valid = current && account.credentialVersion === assignment.credentialVersion && account.authState === "ready" &&
    (auth.kind === "unchanged" || auth.kind === "snapshot" && auth.providerAccountId === account.providerAccountId);
  const status = !current ? "stale" : valid ? "released" : "quarantined";
  const now = Date.now();
  if (occupies) {
    await ctx.db.patch(account._id, {
      activeAssignmentId: undefined, activeOwnershipToken: undefined,
      ...(current ? {
        credentialVersion: account.credentialVersion + 1,
        authState: valid ? "ready" as const : "uncertain" as const,
        ...(valid && auth.kind === "snapshot" ? { ciphertext: auth.ciphertext, iv: auth.iv } : {}),
      } : {}),
      updatedAt: now,
    });
  }
  await ctx.db.patch(assignment._id, {
    phase: status === "quarantined" ? "quarantined" : "released", finalizationStatus: status,
    ...(current ? { credentialVersion: account.credentialVersion + 1 } : {}), updatedAt: now,
  });
  return { status };
}

export const finalize = internalMutation({
  args: { ...fence, auth: v.union(
    v.object({ kind: v.literal("snapshot"), ciphertext: v.string(), iv: v.string(), providerAccountId: v.string() }),
    v.object({ kind: v.literal("unchanged") }), v.object({ kind: v.literal("uncertain") }),
  ) },
  handler: async (ctx, args): Promise<Receipt | null> => {
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || !timingSafeEqual(assignment.ownershipToken, args.ownershipToken)) return null;
    if (assignment.finalizationStatus) return { status: assignment.finalizationStatus };
    if (assignment.phase !== "active" || assignment.generation !== args.generation || assignment.credentialVersion !== args.credentialVersion) return null;
    return finish(ctx, assignment, args.auth);
  },
});

export const unfinished = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("codexAssignments").withIndex("by_finalization", (q) => q.eq("finalizationStatus", undefined)).collect(),
});

/** Only reconcile supplies terminal proof; do not expose this to runtime callers. */
export const terminal = internalMutation({
  args: { ...fence, accountId: v.id("codexAccounts") },
  handler: async (ctx, args): Promise<Receipt | null> => {
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || !timingSafeEqual(assignment.ownershipToken, args.ownershipToken)) return null;
    if (assignment.finalizationStatus) return { status: assignment.finalizationStatus };
    if (assignment.accountId !== args.accountId || assignment.generation !== args.generation || assignment.credentialVersion !== args.credentialVersion) return null;
    // A safe preflight skip already cleared occupancy. Close its retry window.
    if (assignment.phase === "released") {
      await ctx.db.patch(assignment._id, { finalizationStatus: "released", updatedAt: Date.now() });
      return { status: "released" };
    }
    return finish(ctx, assignment, { kind: assignment.phase === "reserved" ? "unchanged" : "uncertain" });
  },
});

/** Time only schedules inspection. GitHub's exact terminal attempt proves stop. */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const assignments = await ctx.runQuery(internal.codexAssignments.unfinished, {});
    for (const assignment of assignments) {
      try {
        const runId = Number(assignment.runId), runAttempt = Number(assignment.runAttempt);
        if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(runAttempt) || runAttempt < 1) continue;
        const installation = await findRepoInstallation(assignment.owner, assignment.repo);
        if (!installation || installation.suspended_at) continue;
        const { token } = await createInstallationToken(installation.id, { repositories: [assignment.repo], permissions: { actions: "read" } });
        const run = await getWorkflowRun({ token, owner: assignment.owner, repo: assignment.repo, runId, runAttempt });
        if (!run || run.id !== runId || run.run_attempt !== runAttempt || run.status !== "completed") continue;
        await ctx.runMutation(internal.codexAssignments.terminal, {
          assignmentId: assignment._id, accountId: assignment.accountId, ownershipToken: assignment.ownershipToken,
          generation: assignment.generation, credentialVersion: assignment.credentialVersion,
        });
      } catch { /* Missing or unavailable GitHub evidence must retain occupancy. */ }
    }
  },
});
