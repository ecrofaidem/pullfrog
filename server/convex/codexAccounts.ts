// Management callers authenticate the operator and validate provider identity
// before sealing auth with lib/crypto. These internal methods enforce storage
// scope; execution capabilities never grant access to management operations.
import { ConvexError, v } from "convex/values";
import { isFreshCodexQuota } from "../../utils/codexQuota";
import type { CodexPoolStatus } from "../../utils/codexPoolProtocol";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const scope = { owner: v.string(), repo: v.union(v.string(), v.null()) };
const repository = { owner: v.string(), repo: v.string() };
const sealedAuth = { providerAccountId: v.string(), ciphertext: v.string(), iv: v.string() };
function normalizeScope<T extends { owner: string; repo: string | null }>(args: T): T {
  const owner = args.owner.trim().toLowerCase();
  const repo = args.repo === null ? null : args.repo.trim().toLowerCase();
  if (!owner || repo === "") throw new Error("Owner and repository scope must be nonempty");
  return { ...args, owner, repo };
}

function metadata(row: Doc<"codexAccounts">) {
  return {
    id: row._id,
    owner: row.owner,
    repo: row.repo,
    label: row.label,
    providerAccountId: row.providerAccountId,
    generation: row.generation,
    credentialVersion: row.credentialVersion,
    enabled: row.enabled,
    authState: row.authState,
    busy: row.activeAssignmentId !== undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function scopedAccount(
  ctx: QueryCtx,
  args: { accountId: Id<"codexAccounts">; owner: string; repo: string | null },
) {
  const row = await ctx.db.get(args.accountId);
  if (!row || row.owner !== args.owner || row.repo !== args.repo) {
    throw new Error("Account does not belong to this scope");
  }
  return row;
}

export const enroll = internalMutation({
  args: { ...scope, ...sealedAuth, label: v.string() },
  handler: async (ctx, input): Promise<Id<"codexAccounts">> => {
    const args = normalizeScope(input);
    const label = args.label.trim();
    if (!label || !args.providerAccountId.trim() || args.providerAccountId !== args.providerAccountId.trim()) {
      throw new Error("Account label and verified provider identity are required");
    }
    const duplicate = await ctx.db.query("codexAccounts")
      .withIndex("by_owner_provider", (q) => q.eq("owner", args.owner).eq("providerAccountId", args.providerAccountId))
      .unique();
    if (duplicate) throw new Error("This provider account is already enrolled for this owner");
    const now = Date.now();
    return ctx.db.insert("codexAccounts", {
      ...args, label, generation: 1, credentialVersion: 1, enabled: true,
      authState: "ready", createdAt: now, updatedAt: now,
    });
  },
});

/** Reenrollment fences old writes, but does not free the old native process. */
export const replace = internalMutation({
  args: { ...scope, ...sealedAuth, accountId: v.id("codexAccounts") },
  handler: async (ctx, input): Promise<number> => {
    const args = normalizeScope(input);
    const row = await scopedAccount(ctx, args);
    if (row.providerAccountId !== args.providerAccountId) {
      throw new Error("Replacement must preserve the provider account identity");
    }
    const generation = row.generation + 1;
    await ctx.db.patch(row._id, {
      ciphertext: args.ciphertext, iv: args.iv, generation, credentialVersion: 1,
      authState: "ready", updatedAt: Date.now(),
    });
    return generation;
  },
});

export const setEnabled = internalMutation({
  args: { ...scope, accountId: v.id("codexAccounts"), enabled: v.boolean() },
  handler: async (ctx, input) => {
    const args = normalizeScope(input);
    const row = await scopedAccount(ctx, args);
    const updatedAt = Date.now();
    await ctx.db.patch(row._id, { enabled: args.enabled, updatedAt });
    return metadata({ ...row, enabled: args.enabled, updatedAt });
  },
});

/** Repository readers see local accounts and only explicitly granted owner accounts. */
async function visibleAccounts(ctx: QueryCtx, args: { owner: string; repo: string | null }) {
  const own = await ctx.db.query("codexAccounts")
    .withIndex("by_scope", (q) => q.eq("owner", args.owner).eq("repo", args.repo)).collect();
  if (args.repo === null) return own;
  const pool = await ctx.db.query("codexPools")
    .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo!)).unique();
  const visible = new Map(own.map((row) => [row._id, row]));
  for (const id of pool?.accountIds ?? []) {
    const row = await ctx.db.get(id);
    if (row?.owner === args.owner && (row.repo === null || row.repo === args.repo)) visible.set(row._id, row);
  }
  return [...visible.values()];
}

export const list = internalQuery({
  args: scope,
  handler: async (ctx, input) => (await visibleAccounts(ctx, normalizeScope(input))).map(metadata),
});

/** Shared private status for the operator HTTP API and authenticated dashboard. */
export async function readCodexPoolStatus(
  ctx: QueryCtx, input: { owner: string; repo: string; scope: "repo" | "account" },
): Promise<CodexPoolStatus> {
  const args = normalizeScope(input);
  const rows = await visibleAccounts(ctx, { owner: args.owner, repo: args.scope === "account" ? null : args.repo });
  const pool = await ctx.db.query("codexPools")
    .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo)).unique();
  const accounts = await Promise.all(rows.map(async (row) => {
    const observation = await ctx.db.query("codexQuotaObservations")
      .withIndex("by_account", (q) => q.eq("accountId", row._id)).unique();
    return {
      id: row._id, label: row.label, repo: row.repo, enabled: row.enabled,
      authState: row.authState, busy: row.activeAssignmentId !== undefined,
      generation: row.generation, credentialVersion: row.credentialVersion,
      quota: observation ? { result: observation.result, observedAt: observation.observedAt, fresh: isFreshCodexQuota(observation, row) } : null,
    };
  }));
  return { accounts, pool: pool ? { enabled: pool.enabled, accountIds: pool.accountIds } : null };
}

export const status = internalQuery({
  args: { ...repository, scope: v.union(v.literal("repo"), v.literal("account")) },
  handler: readCodexPoolStatus,
});

export const configurePool = internalMutation({
  args: { ...repository, accountIds: v.array(v.id("codexAccounts")), enabled: v.optional(v.boolean()), allowOwnerAccounts: v.optional(v.boolean()) },
  handler: async (ctx, input): Promise<Id<"codexPools">> => {
    const args = normalizeScope(input);
    if (new Set(args.accountIds).size !== args.accountIds.length) throw new Error("Duplicate pool member");
    for (const id of args.accountIds) {
      const row = await ctx.db.get(id);
      if (!row || row.owner !== args.owner || (row.repo !== null && row.repo !== args.repo)) {
        throw new Error("Pool member does not belong to this repository scope");
      }
      if (row.repo === null && args.allowOwnerAccounts === false) throw new ConvexError("owner administration required");
    }
    const existing = await ctx.db.query("codexPools")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .unique();
    const value = {
      owner: args.owner, repo: args.repo, accountIds: args.accountIds,
      enabled: args.enabled ?? existing?.enabled ?? false, updatedAt: Date.now(),
    };
    if (!existing) return ctx.db.insert("codexPools", value);
    await ctx.db.patch(existing._id, value);
    return existing._id;
  },
});

export const getPool = internalQuery({
  args: repository,
  handler: async (ctx, input) => {
    const args = normalizeScope(input);
    return ctx.db.query("codexPools")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .unique();
  },
});
