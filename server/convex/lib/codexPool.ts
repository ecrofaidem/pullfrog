import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { Denial } from "../codexAssignments";
import type { CodexAccessAuth } from "../../../utils/codexAccessAuth";
import type { CodexPoolResponse } from "../../../utils/codexPoolProtocol";
import { probeCodexQuota } from "../../../utils/codexQuota";
import { decodeJwtExpMs, codexNeedsRefresh, OAuthInvalidGrantError, parseCodexAuthBody, refreshCodexAuthBody, stringifyCodexAuthBody, type CodexAuthBody } from "./codexOAuth";
import { open, seal } from "./crypto";
import { getCodexProviderAccountId } from "./codexIdentity";
import { parseOAuthErrorBody } from "./oauthShared";

// Covers the hosted workflow lifetime; exec cannot refresh host-managed tokens mid-run.
const ACCESS_ONLY_MARGIN_MS = 6 * 60 * 60 * 1000;

type Assigned = Extract<CodexPoolResponse, { status: "assigned" }>;
type Startup = Denial | { status: "assigned"; codexPool: Assigned; auth: string };

function assigned(assignment: Doc<"codexAssignments">, auth: string, accountId: string): Startup {
  if (assignment.accessOnly) {
    const body = parseCodexAuthBody(auth);
    if (!body) return { status: "denied", reason: "authentication" };
    // Codex 0.153.4 constructs external auth from access-token claims when no ID token is supplied.
    auth = JSON.stringify({ auth_mode: "chatgptAuthTokens", tokens: {
      access_token: body.tokens.access_token, refresh_token: "",
      id_token: body.tokens.id_token ?? body.tokens.access_token, account_id: accountId,
    }, last_refresh: new Date().toISOString() } satisfies CodexAccessAuth);
  }
  return { status: "assigned", auth, codexPool: {
    status: "assigned", version: assignment.accessOnly ? 2 : 1, assignmentId: assignment._id, capability: assignment.ownershipToken,
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
  owner: string; repo: string; runId: string; runAttempt: string; runtimeInstance: string; accessOnly?: boolean;
}): Promise<Startup> {
  const deadline = Date.now() + 20_000;
  const ownershipToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
  const excludedIds: Id<"codexAccounts">[] = [];
  let retryDelayMs = 100;
  let lastBusy: Denial | undefined;
  candidates: while (Date.now() < deadline) {
    const reservation = await ctx.runMutation(internal.codexAssignments.reserve, { ...identity, ownershipToken, excludedIds });
    if (reservation.status === "denied") {
      // Concurrent startups briefly share one refresh lock, not one review slot.
      if (identity.accessOnly && reservation.reason === "busy") {
        lastBusy = reservation;
        await new Promise((resolve) => setTimeout(resolve, Math.min(deadline - Date.now(), retryDelayMs * (0.5 + Math.random() * 0.5))));
        retryDelayMs = Math.min(1000, retryDelayMs * 2);
        continue;
      }
      return reservation;
    }
    lastBusy = undefined;
    const { assignment, account } = reservation;
    let fence = { assignmentId: assignment._id, ownershipToken: assignment.ownershipToken, generation: assignment.generation, credentialVersion: assignment.credentialVersion };
    const quotaFence = () => ({ ...fence, accountId: account._id });
    let raw: string;
    let body: CodexAuthBody | null;
    try { raw = await open(account); body = parseCodexAuthBody(raw); }
    catch { raw = ""; body = null; }
    if (reservation.status === "active") {
      return body && getCodexProviderAccountId(raw) === account.providerAccountId && !body.refresh_rejected_at
        ? assigned(assignment, raw, account.providerAccountId) : { status: "denied", reason: "authentication" };
    }
    if (!body || getCodexProviderAccountId(raw) !== account.providerAccountId || body.refresh_rejected_at) {
      await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: "authentication", rejected: true });
      excludedIds.push(account._id); continue;
    }
    let needsRefresh = identity.accessOnly
      ? codexNeedsRefresh(body, Date.now(), ACCESS_ONLY_MARGIN_MS) : codexNeedsRefresh(body);
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
    if (identity.accessOnly && (decodeJwtExpMs(body.tokens.access_token) ?? 0) - Date.now() < ACCESS_ONLY_MARGIN_MS) {
      await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: "authentication" });
      excludedIds.push(account._id); continue;
    }
    if (quota.status === "available" && Date.now() < deadline) {
      if (await ctx.runMutation(internal.codexAssignments.activate, fence)) return assigned(assignment, raw, account.providerAccountId);
      await ctx.runMutation(internal.codexAssignments.abandon, { ...fence, reason: "configuration" });
      return { status: "denied", reason: "configuration" };
    }
    await ctx.runMutation(internal.codexAssignments.abandon, {
      ...fence, reason: quota.status === "exhausted" ? "exhausted" : quota.status === "authentication" ? "authentication" : "unknown",
      ...(quota.status === "exhausted" ? { retryAt: quota.weekly.resetAt } : {}),
    });
    excludedIds.push(account._id);
  }
  return lastBusy ?? { status: "denied", reason: "unknown" };
}
