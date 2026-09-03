// Repo settings and App installations. `toActionSettings` is the one place the
// dashboard's settings shape becomes the action's RepoSettings.

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireDashboardUser } from "./auth";
import { permissionTier, reviewAuthorsMode } from "./schema";

function defaultReviewAuthors(): string[] {
  return (process.env.DEFAULT_REVIEW_AUTHORS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const get = internalQuery({
  args: { owner: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<Doc<"repos"> | null> =>
    ctx.db
      .query("repos")
      .withIndex("by_owner_name", (q) => q.eq("owner", args.owner).eq("name", args.name))
      .unique(),
});

/** create the row with defaults on first sight; keep defaultBranch current after that. */
export const ensure = internalMutation({
  args: { owner: v.string(), name: v.string(), defaultBranch: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Doc<"repos">> => {
    const existing = await ctx.db
      .query("repos")
      .withIndex("by_owner_name", (q) => q.eq("owner", args.owner).eq("name", args.name))
      .unique();
    if (existing) {
      if (args.defaultBranch && args.defaultBranch !== existing.defaultBranch) {
        await ctx.db.patch(existing._id, { defaultBranch: args.defaultBranch });
        return { ...existing, defaultBranch: args.defaultBranch };
      }
      return existing;
    }
    const id = await ctx.db.insert("repos", {
      owner: args.owner,
      name: args.name,
      enabled: true,
      defaultBranch: args.defaultBranch ?? "main",
      model: "gpt-sol",
      effort: 0.5,
      setupScript: null,
      postCheckoutScript: null,
      push: "restricted",
      shell: "restricted",
      codexAgent: false,
      statusChecks: true,
      progressComments: true,
      handle: process.env.GITHUB_APP_SLUG ?? "frogbot",
      signature: "🐸",
      reviewAuthorsMode: "allowlist",
      reviewAuthors: defaultReviewAuthors(),
      reviewOnSynchronize: true,
      timeout: "1h",
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  },
});

export const setEnabled = internalMutation({
  args: { owner: v.string(), name: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("repos")
      .withIndex("by_owner_name", (q) => q.eq("owner", args.owner).eq("name", args.name))
      .unique();
    if (row) await ctx.db.patch(row._id, { enabled: args.enabled, updatedAt: Date.now() });
  },
});

export const recordInstallation = internalMutation({
  args: {
    owner: v.string(),
    installationId: v.number(),
    isOrg: v.boolean(),
    repositorySelection: v.string(),
    suspended: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("installations")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .unique();
    const doc = { ...args, updatedAt: Date.now() };
    if (row) await ctx.db.replace(row._id, doc);
    else await ctx.db.insert("installations", doc);
  },
});

export const removeInstallation = internalMutation({
  args: { owner: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("installations")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const getInstallation = internalQuery({
  args: { owner: v.string() },
  handler: async (ctx, args): Promise<Doc<"installations"> | null> =>
    ctx.db
      .query("installations")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .unique(),
});

// ── action-facing shape ──────────────────────────────────────────────────────

/** mirrors RepoSettings in action/utils/runContext.ts; the action merges this over its defaults. */
export function toActionSettings(repo: Doc<"repos">): Record<string, unknown> {
  const signature = repo.signature.trim();
  const signOff = signature
    ? `Finish the review body with one final line containing only "${signature}".`
    : undefined;
  return {
    model: repo.model,
    effort: repo.effort,
    modes: [],
    setupScript: repo.setupScript,
    postCheckoutScript: repo.postCheckoutScript,
    prepushScript: null,
    stopScript: null,
    push: repo.push,
    shell: repo.shell,
    prApproveEnabled: false,
    autoMergeEnabled: false,
    codexAgent: repo.codexAgent,
    signedCommits: false,
    repoIntelligence: false,
    progressComments: repo.progressComments,
    statusChecks: repo.statusChecks,
    approvalCheck: false,
    modeInstructions: signOff ? { Review: signOff, IncrementalReview: signOff } : {},
    learnings: null,
    learningsHeadings: [],
    envAllowlist: null,
    xrepoBrief: null,
    xrepoLearnings: null,
    xrepoLearningsHeadings: [],
  };
}

// ── dashboard ────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx): Promise<Doc<"repos">[]> => {
    await requireDashboardUser(ctx);
    return ctx.db.query("repos").collect();
  },
});

export const byName = query({
  args: { owner: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<Doc<"repos"> | null> => {
    await requireDashboardUser(ctx);
    return ctx.db
      .query("repos")
      .withIndex("by_owner_name", (q) => q.eq("owner", args.owner).eq("name", args.name))
      .unique();
  },
});

const TIMEOUT_RE = /^(\d+h)?(\d+m)?$/;

const patchValidator = v.object({
  enabled: v.optional(v.boolean()),
  model: v.optional(v.union(v.string(), v.null())),
  effort: v.optional(v.union(v.number(), v.null())),
  setupScript: v.optional(v.union(v.string(), v.null())),
  postCheckoutScript: v.optional(v.union(v.string(), v.null())),
  push: v.optional(permissionTier),
  shell: v.optional(permissionTier),
  codexAgent: v.optional(v.boolean()),
  statusChecks: v.optional(v.boolean()),
  progressComments: v.optional(v.boolean()),
  handle: v.optional(v.string()),
  signature: v.optional(v.string()),
  reviewAuthorsMode: v.optional(reviewAuthorsMode),
  reviewAuthors: v.optional(v.array(v.string())),
  reviewOnSynchronize: v.optional(v.boolean()),
  timeout: v.optional(v.string()),
});

export type RepoPatch = typeof patchValidator.type;

/** normalise and check a patch; throws a plain sentence the dashboard can show beside the field. */
export function validatePatch(input: RepoPatch): RepoPatch {
  const patch = { ...input };
  if (patch.effort !== undefined && patch.effort !== null) {
    if (!(patch.effort >= 0 && patch.effort <= 1)) throw new Error("effort must be within [0,1]");
  }
  if (patch.timeout !== undefined) {
    const t = patch.timeout.trim();
    if (!t || !TIMEOUT_RE.test(t)) throw new Error("timeout must look like 45m, 1h or 1h30m");
    patch.timeout = t;
  }
  if (patch.handle !== undefined) {
    const h = patch.handle.trim().replace(/^@/, "");
    if (!/^[a-z0-9-]+$/i.test(h)) throw new Error("handle must be a GitHub App slug");
    patch.handle = h;
  }
  if (patch.reviewAuthors !== undefined) {
    patch.reviewAuthors = [
      ...new Set(patch.reviewAuthors.map((s) => s.trim().replace(/^@/, "").toLowerCase())),
    ].filter(Boolean);
  }
  if (patch.model !== undefined && patch.model !== null && !patch.model.trim()) patch.model = null;
  for (const key of ["setupScript", "postCheckoutScript"] as const) {
    const value = patch[key];
    if (typeof value === "string" && !value.trim()) patch[key] = null;
  }
  return patch;
}

/** CLI path: same rules as the dashboard, attributed to the CLI user. */
export const applyConfig = internalMutation({
  args: { owner: v.string(), name: v.string(), patch: patchValidator, updatedBy: v.string() },
  handler: async (ctx, args): Promise<Doc<"repos">> => {
    const row = await ctx.db
      .query("repos")
      .withIndex("by_owner_name", (q) => q.eq("owner", args.owner).eq("name", args.name))
      .unique();
    if (!row) throw new Error(`${args.owner}/${args.name} is not enabled on this server`);
    const patch = validatePatch(args.patch);
    await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now(), updatedBy: args.updatedBy });
    return (await ctx.db.get(row._id))!;
  },
});

export const update = mutation({
  args: { id: v.id("repos"), patch: patchValidator },
  handler: async (ctx, args) => {
    const user = await requireDashboardUser(ctx);
    const patch = validatePatch(args.patch);
    await ctx.db.patch(args.id, { ...patch, updatedAt: Date.now(), updatedBy: user.login });
  },
});
