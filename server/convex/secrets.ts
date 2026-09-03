// Encrypted secret store. Values only ever leave this table through
// run-context (to the action) and are only ever written by the CLI, the
// post-run write-back, or a refresh this service performed itself.

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireDashboardUser } from "./auth";

const scope = { owner: v.string(), repo: v.union(v.string(), v.null()) };

export const LEASE_MS = 20_000;

/** repo-scoped row wins over account-scoped; null when neither exists. */
export const resolve = internalQuery({
  args: { owner: v.string(), repo: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<Doc<"secrets"> | null> => {
    const repoRow = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("name", args.name)
      )
      .unique();
    if (repoRow) return repoRow;
    return ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) =>
        q.eq("owner", args.owner).eq("repo", null).eq("name", args.name)
      )
      .unique();
  },
});

export const getById = internalQuery({
  args: { id: v.id("secrets") },
  handler: async (ctx, args): Promise<Doc<"secrets"> | null> => ctx.db.get(args.id),
});

/** every secret visible to a repo: its own rows plus the account's, repo winning on name clashes. */
export const visibleTo = internalQuery({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<Doc<"secrets">[]> => {
    const account = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) => q.eq("owner", args.owner).eq("repo", null))
      .collect();
    const repo = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .collect();
    const byName = new Map<string, Doc<"secrets">>();
    for (const row of account) byName.set(row.name, row);
    for (const row of repo) byName.set(row.name, row);
    return [...byName.values()];
  },
});

export const upsert = internalMutation({
  args: {
    ...scope,
    name: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"secrets">> => {
    const existing = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("name", args.name)
      )
      .unique();
    const now = Date.now();
    if (existing) {
      // a fresh write re-arms rotation: clear the rejection latch and any lease.
      await ctx.db.replace(existing._id, {
        owner: args.owner,
        repo: args.repo,
        name: args.name,
        ciphertext: args.ciphertext,
        iv: args.iv,
        updatedAt: now,
        ...(args.updatedBy ? { updatedBy: args.updatedBy } : {}),
      });
      return existing._id;
    }
    return ctx.db.insert("secrets", {
      owner: args.owner,
      repo: args.repo,
      name: args.name,
      ciphertext: args.ciphertext,
      iv: args.iv,
      updatedAt: now,
      ...(args.updatedBy ? { updatedBy: args.updatedBy } : {}),
    });
  },
});

/**
 * try to become the one caller that refreshes this chain. `updatedAt` is the
 * version the caller read; if the row moved on since, someone else already
 * rotated it and the caller should re-read instead.
 */
export const claimLease = internalMutation({
  args: { id: v.id("secrets"), updatedAt: v.number() },
  handler: async (ctx, args): Promise<"granted" | "busy" | "changed"> => {
    const row = await ctx.db.get(args.id);
    if (!row) return "changed";
    if (row.updatedAt !== args.updatedAt) return "changed";
    const now = Date.now();
    if (row.leaseUntil && row.leaseUntil > now) return "busy";
    await ctx.db.patch(args.id, { leaseUntil: now + LEASE_MS });
    return "granted";
  },
});

export const commitRefresh = internalMutation({
  args: { id: v.id("secrets"), ciphertext: v.string(), iv: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, {
      ciphertext: args.ciphertext,
      iv: args.iv,
      updatedAt: now,
      lastRefreshAt: now,
      leaseUntil: undefined,
      refreshRejectedAt: undefined,
      refreshRejectedReason: undefined,
    });
  },
});

export const releaseLease = internalMutation({
  args: { id: v.id("secrets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { leaseUntil: undefined });
  },
});

/** the provider said this chain is permanently dead; stop retrying until a reseed. */
export const markRejected = internalMutation({
  args: { id: v.id("secrets"), ciphertext: v.string(), iv: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, {
      ciphertext: args.ciphertext,
      iv: args.iv,
      updatedAt: now,
      leaseUntil: undefined,
      refreshRejectedAt: now,
      refreshRejectedReason: args.reason,
    });
  },
});

export const names = internalQuery({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<{ account: string[]; repo: string[] }> => {
    const account = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) => q.eq("owner", args.owner).eq("repo", null))
      .collect();
    const repo = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .collect();
    return { account: account.map((r) => r.name), repo: repo.map((r) => r.name) };
  },
});

// ── dashboard ────────────────────────────────────────────────────────────────

export interface SecretStatus {
  id: Id<"secrets">;
  name: string;
  scope: "account" | "repo";
  updatedAt: number;
  updatedBy: string | undefined;
  lastRefreshAt: number | undefined;
  refreshRejectedAt: number | undefined;
  refreshRejectedReason: string | undefined;
}

/** names and health only; values never reach the dashboard. */
export const status = query({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<SecretStatus[]> => {
    await requireDashboardUser(ctx);
    const account = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) => q.eq("owner", args.owner).eq("repo", null))
      .collect();
    const repo = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .collect();
    const toStatus = (row: Doc<"secrets">, scopeName: "account" | "repo"): SecretStatus => ({
      id: row._id,
      name: row.name,
      scope: scopeName,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      lastRefreshAt: row.lastRefreshAt,
      refreshRejectedAt: row.refreshRejectedAt,
      refreshRejectedReason: row.refreshRejectedReason,
    });
    const byName = new Map<string, SecretStatus>();
    for (const r of account) byName.set(r.name, toStatus(r, "account"));
    for (const r of repo) byName.set(r.name, toStatus(r, "repo"));
    return [...byName.values()];
  },
});

export const remove = mutation({
  args: { id: v.id("secrets") },
  handler: async (ctx, args) => {
    await requireDashboardUser(ctx);
    await ctx.db.delete(args.id);
  },
});
