// The envelope's `version` must satisfy the action's compatibility range
// (action/utils/versioning.ts), so it tracks the fork's package.json rather
// than a hardcoded string: an upstream merge that bumps the version would
// otherwise strand every dispatch.

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const TTL_MS = 60 * 60 * 1000;

export function actionRepo(): string {
  return process.env.ACTION_REPO ?? "ecrofaidem/pullfrog";
}
export function actionRef(): string {
  return process.env.ACTION_REF ?? "main";
}
export function actionWorkflow(): string {
  return process.env.ACTION_WORKFLOW ?? "pullfrog.yml";
}

export const get = internalQuery({
  args: { repo: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("actionVersion")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .unique(),
});

export const set = internalMutation({
  args: { repo: v.string(), version: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("actionVersion")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .unique();
    const doc = { repo: args.repo, version: args.version, fetchedAt: Date.now() };
    if (row) await ctx.db.replace(row._id, doc);
    else await ctx.db.insert("actionVersion", doc);
  },
});

export async function resolveActionVersion(ctx: ActionCtx): Promise<string> {
  const key = `${actionRepo()}@${actionRef()}`;
  const cached = await ctx.runQuery(internal.actionVersion.get, { repo: key });
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.version;
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/${actionRepo()}/${actionRef()}/package.json`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) throw new Error(`package.json fetch ${response.status}`);
    const pkg = (await response.json()) as { version?: string };
    if (!pkg.version) throw new Error("package.json has no version");
    await ctx.runMutation(internal.actionVersion.set, { repo: key, version: pkg.version });
    return pkg.version;
  } catch (err) {
    if (cached) return cached.version;
    throw new Error(`cannot resolve action version for ${key}: ${String(err)}`);
  }
}
