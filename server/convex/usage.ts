// The ChatGPT subscription's remaining limit, read from the same endpoint the
// Codex CLI's status screen uses, for every stored chain. A cron keeps it
// fresh so the dashboard's HEAD line can show it without a fetch of its own.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { parseCodexAuthBody } from "./lib/codexOAuth";
import { open } from "./lib/crypto";
import { decodeClaims } from "./lib/jwt";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

interface Window {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

export const chains = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"secrets">[]> => {
    const rows = await ctx.db.query("secrets").collect();
    return rows.filter((r) => r.name === "CODEX_AUTH_JSON" && !r.refreshRejectedAt);
  },
});

export const record = internalMutation({
  args: {
    secretId: v.id("secrets"),
    plan: v.optional(v.string()),
    usedPercent: v.number(),
    windowSeconds: v.number(),
    resetAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("codexUsage")
      .withIndex("by_secret", (q) => q.eq("secretId", args.secretId))
      .unique();
    const doc = { ...args, fetchedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("codexUsage", doc);
  },
});

function accountIdFromToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const auth = decodeClaims(token)["https://api.openai.com/auth"];
    if (auth && typeof auth === "object" && "chatgpt_account_id" in auth) {
      const id = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id;
      return typeof id === "string" ? id : undefined;
    }
  } catch {
    // not a readable JWT
  }
  return undefined;
}

export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<{ refreshed: number; failed: number }> => {
    const rows = await ctx.runQuery(internal.usage.chains, {});
    let refreshed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const body = parseCodexAuthBody(await open(row));
        if (!body) throw new Error("malformed chain");
        const accountId =
          body.tokens.account_id ??
          accountIdFromToken(body.tokens.id_token) ??
          accountIdFromToken(body.tokens.access_token);
        const response = await fetch(USAGE_URL, {
          headers: {
            Authorization: `Bearer ${body.tokens.access_token}`,
            ...(accountId ? { "chatgpt-account-id": accountId } : {}),
            Accept: "application/json",
            "User-Agent": "frogbot-server",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`usage ${response.status}`);
        const data = (await response.json()) as {
          plan_type?: string;
          rate_limit?: { primary_window?: Window | null; secondary_window?: Window | null };
        };
        const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].filter(
          (w): w is Window =>
            !!w && typeof w.used_percent === "number" && typeof w.limit_window_seconds === "number"
        );
        const longest = windows.sort((a, b) => b.limit_window_seconds! - a.limit_window_seconds!)[0];
        if (!longest) throw new Error("no rate-limit window in response");
        await ctx.runMutation(internal.usage.record, {
          secretId: row._id,
          ...(data.plan_type ? { plan: data.plan_type } : {}),
          usedPercent: Math.max(0, Math.min(100, Math.round(longest.used_percent!))),
          windowSeconds: longest.limit_window_seconds!,
          resetAt: longest.reset_at ?? 0,
        });
        refreshed += 1;
      } catch (err) {
        failed += 1;
        console.warn(`codex usage read failed for ${row.owner}/${row.repo ?? "account"}: ${String(err)}`);
      }
    }
    return { refreshed, failed };
  },
});
