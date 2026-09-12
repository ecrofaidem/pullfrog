// Management callers authenticate the operator and validate provider identity
// before sealing auth with lib/crypto. These internal methods enforce storage
// scope; execution capabilities never grant access to management operations.
import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { timingSafeEqual } from "./lib/crypto";

const scope = { owner: v.string(), repo: v.union(v.string(), v.null()) };
const repository = { owner: v.string(), repo: v.string() };
const sealedAuth = { providerAccountId: v.string(), ciphertext: v.string(), iv: v.string() };
const credentialFence = {
  accountId: v.id("codexAccounts"),
  generation: v.number(),
  credentialVersion: v.number(),
  assignmentId: v.string(),
  ownershipToken: v.string(),
};

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

function ownsCredentials(
  row: Doc<"codexAccounts"> | null,
  args: { generation: number; credentialVersion: number; assignmentId: string; ownershipToken: string },
): row is Doc<"codexAccounts"> {
  return row !== null &&
    row.generation === args.generation &&
    row.credentialVersion === args.credentialVersion &&
    row.activeAssignmentId === args.assignmentId &&
    row.activeOwnershipToken !== undefined &&
    timingSafeEqual(row.activeOwnershipToken, args.ownershipToken);
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

/** Owner-scope inspection lists owner accounts; repository inspection requires membership. */
export const list = internalQuery({
  args: scope,
  handler: async (ctx, input) => {
    const args = normalizeScope(input);
    const own = await ctx.db.query("codexAccounts")
      .withIndex("by_scope", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .collect();
    if (args.repo === null) return own.map(metadata);
    const pool = await ctx.db.query("codexPools")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo!))
      .unique();
    const visible = new Map(own.map((row) => [row._id, row]));
    for (const id of pool?.accountIds ?? []) {
      const row = await ctx.db.get(id);
      if (row?.owner === args.owner && (row.repo === null || row.repo === args.repo)) {
        visible.set(row._id, row);
      }
    }
    return [...visible.values()].map(metadata);
  },
});

export const configurePool = internalMutation({
  args: { ...repository, accountIds: v.array(v.id("codexAccounts")), enabled: v.optional(v.boolean()) },
  handler: async (ctx, input): Promise<Id<"codexPools">> => {
    const args = normalizeScope(input);
    if (new Set(args.accountIds).size !== args.accountIds.length) throw new Error("Duplicate pool member");
    for (const id of args.accountIds) {
      const row = await ctx.db.get(id);
      if (!row || row.owner !== args.owner || (row.repo !== null && row.repo !== args.repo)) {
        throw new Error("Pool member does not belong to this repository scope");
      }
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

/** Internal preflight input only. Never expose all these ciphertexts to a runner. */
export const getPoolAccounts = internalQuery({
  args: repository,
  handler: async (ctx, input): Promise<Doc<"codexAccounts">[]> => {
    const args = normalizeScope(input);
    const pool = await ctx.db.query("codexPools")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .unique();
    if (!pool?.enabled) return [];
    const rows: Doc<"codexAccounts">[] = [];
    for (const id of pool.accountIds) {
      const row = await ctx.db.get(id);
      if (!row || row.owner !== args.owner || (row.repo !== null && row.repo !== args.repo)) {
        throw new Error("Pool member does not belong to this repository scope");
      }
      rows.push(row);
    }
    return rows;
  },
});

/** A runner-owned chain can advance only under its exact credential version. */
export const updateCredentials = internalMutation({
  args: { ...credentialFence, ...sealedAuth },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.get(args.accountId);
    if (!ownsCredentials(row, args) || row.providerAccountId !== args.providerAccountId) return false;
    await ctx.db.patch(row._id, {
      ciphertext: args.ciphertext, iv: args.iv, credentialVersion: row.credentialVersion + 1,
      authState: "ready", updatedAt: Date.now(),
    });
    return true;
  },
});

/** Delayed provider failures must not poison replacement or refreshed credentials. */
export const markAuthState = internalMutation({
  args: { ...credentialFence, authState: v.union(v.literal("rejected"), v.literal("uncertain")) },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.get(args.accountId);
    if (!ownsCredentials(row, args)) return false;
    await ctx.db.patch(row._id, { authState: args.authState, credentialVersion: row.credentialVersion + 1, updatedAt: Date.now() });
    return true;
  },
});
