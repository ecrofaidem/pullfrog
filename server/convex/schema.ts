import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const permissionTier = v.union(
  v.literal("disabled"),
  v.literal("restricted"),
  v.literal("enabled")
);

export const reviewAuthorsMode = v.union(v.literal("all"), v.literal("allowlist"));

export const runStatus = v.union(
  v.literal("dispatched"),
  v.literal("queued"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

export default defineSchema({
  /** one row per GitHub account the App is installed on. */
  installations: defineTable({
    owner: v.string(),
    installationId: v.number(),
    isOrg: v.boolean(),
    repositorySelection: v.string(),
    suspended: v.boolean(),
    updatedAt: v.number(),
  }).index("by_owner", ["owner"]),

  /**
   * per-repo settings. the first block mirrors the fields of the action's
   * RepoSettings that we let people edit (see action/utils/runContext.ts); the
   * second block is dispatcher policy the action never sees.
   */
  repos: defineTable({
    owner: v.string(),
    name: v.string(),
    enabled: v.boolean(),
    defaultBranch: v.string(),

    model: v.union(v.string(), v.null()),
    /** reasoning-effort position on [0,1]; the action lands it on the model's ladder */
    effort: v.union(v.number(), v.null()),
    setupScript: v.union(v.string(), v.null()),
    postCheckoutScript: v.union(v.string(), v.null()),
    push: permissionTier,
    shell: permissionTier,
    codexAgent: v.boolean(),
    statusChecks: v.boolean(),
    progressComments: v.boolean(),

    /** comment handle without the @, e.g. `frogbot` */
    handle: v.string(),
    /** appended to every review body, e.g. 🐸 */
    signature: v.string(),
    reviewAuthorsMode,
    reviewAuthors: v.array(v.string()),
    reviewOnSynchronize: v.boolean(),
    /** action `timeout` input, e.g. `1h` */
    timeout: v.string(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  }).index("by_owner_name", ["owner", "name"]),

  /** encrypted secret values. `repo: null` is account scope (shared across the owner's repos). */
  secrets: defineTable({
    owner: v.string(),
    repo: v.union(v.string(), v.null()),
    name: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
    /** Codex chain bookkeeping; absent on plain API keys */
    lastRefreshAt: v.optional(v.number()),
    refreshRejectedAt: v.optional(v.number()),
    refreshRejectedReason: v.optional(v.string()),
    /** refresh lease: the holder rotates the chain, everyone else waits and re-reads */
    leaseUntil: v.optional(v.number()),
  }).index("by_scope_name", ["owner", "repo", "name"]),

  /** one row per dispatched or observed action run. */
  runs: defineTable({
    owner: v.string(),
    repo: v.string(),
    /** short id we bake into the run-name so workflow_run webhooks can find us */
    dispatchId: v.optional(v.string()),
    githubRunId: v.optional(v.number()),
    htmlUrl: v.optional(v.string()),
    kind: v.string(),
    trigger: v.string(),
    prNumber: v.optional(v.number()),
    triggerer: v.optional(v.string()),
    title: v.string(),
    status: runStatus,
    conclusion: v.optional(v.string()),
    checkRunId: v.optional(v.number()),
    /** fields the action PATCHes back (see action/utils/patchWorkflowRunFields.ts) */
    model: v.optional(v.string()),
    agent: v.optional(v.string()),
    credential: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    prNodeId: v.optional(v.string()),
    issueNodeId: v.optional(v.string()),
    reviewNodeId: v.optional(v.string()),
    planCommentNodeId: v.optional(v.string()),
    summarySnapshot: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_repo", ["owner", "repo", "createdAt"])
    .index("by_github_run", ["githubRunId"])
    .index("by_dispatch", ["dispatchId"]),

  /** GitHub redelivers on any non-2xx; this makes a redelivery a no-op. */
  webhookDeliveries: defineTable({
    deliveryId: v.string(),
    receivedAt: v.number(),
  }).index("by_delivery", ["deliveryId"]),

  /** cached package.json version of the action repo, so the envelope's `version` tracks merges. */
  actionVersion: defineTable({
    repo: v.string(),
    version: v.string(),
    fetchedAt: v.number(),
  }).index("by_repo", ["repo"]),
});
