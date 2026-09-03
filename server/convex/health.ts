// The one sentence at HEAD, from one subscription. Every view reads this
// instead of joining runs and secrets on the client, so the sentence can never
// differ between tabs and the read set is one query.

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireDashboardUser } from "./auth";

export interface ChainHealth {
  scope: "account" | "repo";
  updatedAt: number;
  updatedBy: string | undefined;
  lastRefreshAt: number | undefined;
  refreshRejectedAt: number | undefined;
  refreshRejectedReason: string | undefined;
}

export interface RecentRun {
  id: string;
  status: Doc<"runs">["status"];
  createdAt: number;
  htmlUrl: string | undefined;
  prNumber: number | undefined;
}

export interface HealthData {
  chain: ChainHealth | null;
  recent: RecentRun[];
}

export const get = query({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<HealthData> => {
    await requireDashboardUser(ctx);
    // repo-scoped chain wins over the account's, matching what run-context hands the action.
    const repoRow = await ctx.db
      .query("secrets")
      .withIndex("by_scope_name", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("name", "CODEX_AUTH_JSON")
      )
      .unique();
    const row =
      repoRow ??
      (await ctx.db
        .query("secrets")
        .withIndex("by_scope_name", (q) =>
          q.eq("owner", args.owner).eq("repo", null).eq("name", "CODEX_AUTH_JSON")
        )
        .unique());
    const chain: ChainHealth | null = row
      ? {
          scope: row.repo === null ? "account" : "repo",
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
          lastRefreshAt: row.lastRefreshAt,
          refreshRejectedAt: row.refreshRejectedAt,
          refreshRejectedReason: row.refreshRejectedReason?.slice(0, 200),
        }
      : null;
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .order("desc")
      .take(5);
    return {
      chain,
      recent: runs.map((r) => ({
        id: r._id,
        status: r.status,
        createdAt: r.createdAt,
        htmlUrl: r.htmlUrl,
        prNumber: r.prNumber,
      })),
    };
  },
});
