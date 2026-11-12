// Raw material for the Usage page: the pool's accounts in fallback order with
// their weekly-limit history, and the runs they served. Rates, projections and
// what-ifs are derived on the client (web/src/lib/usage.ts) against the shared
// clock, so this query only changes when data does.

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireDashboardUser } from "./auth";

export const WINDOW_MS = 28 * 24 * 3600_000;

export interface UsageSample {
  at: number;
  usedPercent: number;
  /** ms */
  resetAt: number;
  status: Doc<"codexQuotaSamples">["status"];
}

export interface UsageAccount {
  id: Id<"codexAccounts">;
  label: string;
  plan: string | undefined;
  /** turned on and holding a working login: the only accounts the pool will hand out */
  enabled: boolean;
  samples: UsageSample[];
  /** runs and tokens this account served in the window, across every repo that shares it */
  servedRuns: number;
  servedTokens: number;
}

export interface UsageRun {
  id: Id<"runs">;
  createdAt: number;
  completedAt: number | undefined;
  status: Doc<"runs">["status"];
  kind: string;
  prNumber: number | undefined;
  prTitle: string | undefined;
  htmlUrl: string | undefined;
  tokens: number;
  lines: number | undefined;
  accountId: Id<"codexAccounts"> | undefined;
  quotaStart: number | undefined;
  quotaEnd: number | undefined;
  speed: string | undefined;
  subagents: number | undefined;
  /** another run, in any repo, used the same account while this one ran */
  overlapped: boolean;
}

export interface UsageReport {
  since: number;
  /** false when the pool exists but is turned off, so runs use no pooled account */
  poolEnabled: boolean;
  /** pool members in the order runs try them; empty when the repo has no pool */
  accounts: UsageAccount[];
  runs: UsageRun[];
}

export const get = query({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<UsageReport> => {
    await requireDashboardUser(ctx);
    const since = Date.now() - WINDOW_MS;
    // pools are keyed by the lowercased scope (codexAccounts.normalizeScope); runs keep GitHub's casing
    const pool = await ctx.db.query("codexPools")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner.trim().toLowerCase()).eq("repo", args.repo.trim().toLowerCase())).unique();
    const now = Date.now();
    const accounts: UsageAccount[] = [];
    const overlapped = new Set<Id<"runs">>();
    for (const id of pool?.accountIds ?? []) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      const samples = await ctx.db.query("codexQuotaSamples")
        .withIndex("by_account_time", (q) => q.eq("accountId", id).gte("observedAt", since)).collect();
      const served = await ctx.db.query("runUsage")
        .withIndex("by_account", (q) => q.eq("codexAccountId", id).gte("createdAt", since)).collect();
      // sorted by start: a run overlaps when it starts before the latest end seen so far
      let latest: { end: number; id: Id<"runs"> } | undefined;
      for (const r of served) {
        const end = r.completedAt ?? now;
        if (latest && r.createdAt < latest.end) {
          overlapped.add(r.runId);
          overlapped.add(latest.id);
        }
        if (!latest || end > latest.end) latest = { end, id: r.runId };
      }
      accounts.push({
        id, label: row.label, enabled: row.enabled && row.authState === "ready",
        servedRuns: served.filter((r) => r.tokens > 0).length,
        servedTokens: served.reduce((n, r) => n + r.tokens, 0),
        plan: [...samples].reverse().find((s) => s.plan)?.plan,
        samples: samples.map((s) => ({ at: s.observedAt, usedPercent: s.usedPercent, resetAt: s.resetAt * 1000, status: s.status })),
      });
    }
    // the slim mirror, never whole run documents: those carry summary snapshots
    const runs = await ctx.db.query("runUsage")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo).gte("createdAt", since)).collect();
    return {
      since,
      poolEnabled: pool?.enabled ?? false,
      accounts,
      runs: runs.map((r) => ({
        id: r.runId, createdAt: r.createdAt, completedAt: r.completedAt, status: r.status, kind: r.kind,
        prNumber: r.prNumber, prTitle: r.prTitle, htmlUrl: r.htmlUrl, tokens: r.tokens, lines: r.lines,
        accountId: r.codexAccountId, quotaStart: r.quotaStartPercent, quotaEnd: r.quotaEndPercent,
        speed: r.codexSpeed, subagents: r.codexSubagents, overlapped: overlapped.has(r.runId),
      })),
    };
  },
});
