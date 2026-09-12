import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { Denial } from "../codexAssignments";
import type { CodexPoolResponse } from "../../../utils/codexPoolProtocol";
import { probeCodexQuota } from "../../../utils/codexQuota";
import { codexNeedsRefresh, OAuthInvalidGrantError, parseCodexAuthBody, refreshCodexAuthBody, stringifyCodexAuthBody, type CodexAuthBody } from "./codexOAuth";
import { open, seal } from "./crypto";
import { getCodexProviderAccountId } from "./codexIdentity";
import { parseOAuthErrorBody } from "./oauthShared";

type Assigned = Extract<CodexPoolResponse, { status: "assigned" }>;
type Startup = Denial | { status: "assigned"; codexPool: Assigned; auth: string };

function assigned(assignment: Doc<"codexAssignments">, auth: string): Startup {
  return { status: "assigned", auth, codexPool: {
    status: "assigned", version: 1, assignmentId: assignment._id, capability: assignment.ownershipToken,
    accountAlias: assignment.accountAlias, generation: assignment.generation,
    runAttempt: assignment.runAttempt, runtimeInstance: assignment.runtimeInstance,
  } };
}

/** Fetch/body implementations may ignore abort; bound our wait as well as signaling cancellation. */
async function refreshBefore(body: CodexAuthBody, deadline: number): Promise<CodexAuthBody> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("refresh deadline")); }, Math.max(0, Math.min(10_000, deadline - Date.now())));
  });
  try { return await Promise.race([refreshCodexAuthBody(body, controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}

/** Only this invocation sees the preflight ownership token. Runtime receives it after activation. */
export async function startCodexPool(ctx: ActionCtx, identity: {
  owner: string; repo: string; runId: string; runAttempt: string; runtimeInstance: string;
}): Promise<Startup> {
  const deadline = Date.now() + 20_000;
  const ownershipToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
  const excludedIds: Id<"codexAccounts">[] = [];
  candidates: while (Date.now() < deadline) {
    const reservation = await ctx.runMutation(internal.codexAssignments.reserve, { ...identity, ownershipToken, excludedIds });
    if (reservation.status === "denied") return reservation;
    const { assignment, account } = reservation;
    let fence = { assignmentId: assignment._id, ownershipToken: assignment.ownershipToken, generation: assignment.generation, credentialVersion: assignment.credentialVersion };
    const quotaFence = () => ({ ...fence, accountId: account._id });
    let raw: string;
    let body: CodexAuthBody | null;
    try { raw = await open(account); body = parseCodexAuthBody(raw); }
    catch { raw = ""; body = null; }
    if (reservation.status === "active") {
      return body && getCodexProviderAccountId(raw) === account.providerAccountId && !body.refresh_rejected_at
        ? assigned(assignment, raw) : { status: "denied", reason: "authentication" };
    }
    if (!body || getCodexProviderAccountId(raw) !== account.providerAccountId || body.refresh_rejected_at) {
      await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: "authentication", rejected: true });
      excludedIds.push(account._id); continue;
    }
    let needsRefresh = codexNeedsRefresh(body);
    let didRefresh = false;
    let quota;
    while (true) {
      if (needsRefresh) {
        if (Date.now() >= deadline || !await ctx.runMutation(internal.codexAssignments.refreshStarted, fence)) {
          await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: "configuration" });
          return { status: "denied", reason: "configuration" };
        }
        try {
          const rotated = await refreshBefore(body, deadline);
          const text = stringifyCodexAuthBody(rotated);
          if (!parseCodexAuthBody(text) || getCodexProviderAccountId(text) !== account.providerAccountId) throw new Error("invalid rotated auth");
          if (!await ctx.runMutation(internal.codexAssignments.commitRefresh, { ...fence, providerAccountId: account.providerAccountId, ...await seal(text) })) {
            await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: "configuration" });
            return { status: "denied", reason: "configuration" };
          }
          fence = { ...fence, credentialVersion: fence.credentialVersion + 1 };
          raw = text; body = rotated;
          didRefresh = true; needsRefresh = false;
        } catch (err) {
          const rejected = err instanceof OAuthInvalidGrantError &&
            (err.chainIsDead || parseOAuthErrorBody(err.responseBody)?.error === "invalid_grant");
          await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: rejected ? "authentication" : "unknown", rejected });
          // Uncertain refresh retains occupancy; a new invocation cannot retry that token.
          excludedIds.push(account._id); continue candidates;
        }
      }
      const cached = await ctx.runQuery(internal.codexQuota.cached, quotaFence());
      const observedAt = Date.now();
      quota = cached?.result ?? await probeCodexQuota({ accessToken: body.tokens.access_token, accountId: account.providerAccountId, deadline });
      if (!cached) await ctx.runMutation(internal.codexQuota.record, { ...quotaFence(), observedAt, result: quota });
      // A quota 401 can precede the JWT expiry. Refresh once while we still own the chain.
      if (quota.status === "authentication" && !didRefresh) { needsRefresh = true; continue; }
      break;
    }
    if (quota.status === "available" && Date.now() < deadline) {
      if (await ctx.runMutation(internal.codexAssignments.activate, fence)) return assigned(assignment, raw);
      await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: "configuration" });
      return { status: "denied", reason: "configuration" };
    }
    await ctx.runMutation(internal.codexAssignments.abandon, {
      ...fence, reason: quota.status === "exhausted" ? "exhausted" : quota.status === "authentication" ? "authentication" : "unknown",
      ...(quota.status === "exhausted" ? { retryAt: quota.weekly.resetAt } : {}),
    });
    excludedIds.push(account._id);
  }
  return { status: "denied", reason: "unknown" };
}
