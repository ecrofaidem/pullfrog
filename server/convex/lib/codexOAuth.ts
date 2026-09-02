// Ported from action/utils/codexOAuth.ts (fetch-only, no node deps). Keep in
// sync when merging upstream — the refresh endpoint, client id and the
// `error.code` dialect are all measured facts recorded there.

import { decodeJwtExpMs, OAuthInvalidGrantError, parseOAuthErrorBody } from "./oauthShared";

export { decodeJwtExpMs, OAuthInvalidGrantError };

export interface CodexAuthBody {
  auth_mode: "chatgpt";
  tokens: {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
  /**
   * ISO timestamp of a rejection OpenAI attributed to the token itself
   * (`error.code: "token_expired"`). OpenAI rotates the refresh token on every
   * use, so such a rejection is PERMANENT — the latch stops us re-issuing the
   * same doomed refresh on every run. Cleared implicitly: `pullfrog auth codex`
   * and `PUT /api/runtime/secret` write a fresh blob without it.
   */
  refresh_rejected_at?: string;
}

/** OAuth client id Codex CLI and OpenCode both use against `auth.openai.com`. */
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in?: number;
}

/** OpenAI does NOT answer RFC 6749 codes here: `error` is an OBJECT and the
 * discriminator is `error.code`. A spent refresh answers `401 code:"token_expired"`. */
function codexChainIsDead(body: string): boolean {
  const err = parseOAuthErrorBody(body)?.error;
  if (!err || typeof err !== "object") return false;
  return "code" in err && (err as { code?: unknown }).code === "token_expired";
}

/** force one refresh round-trip against the OAuth provider. returns the
 * rotated Codex-shaped blob. does NOT persist — the caller holds the lease. */
export async function refreshCodexAuthBody(body: CodexAuthBody): Promise<CodexAuthBody> {
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: body.tokens.refresh_token,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status >= 400 && response.status < 500) {
      throw new OAuthInvalidGrantError("Codex", response.status, text, codexChainIsDead(text));
    }
    throw new Error(`Codex token refresh failed: ${response.status} ${text}`);
  }
  const tokens = (await response.json()) as OAuthTokenResponse;
  const idToken = tokens.id_token ?? body.tokens.id_token;
  const accountId = body.tokens.account_id;
  return {
    auth_mode: "chatgpt",
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      ...(idToken ? { id_token: idToken } : {}),
      ...(accountId ? { account_id: accountId } : {}),
    },
    last_refresh: new Date().toISOString(),
  };
}

/** parse + validate a Codex auth.json body from its JSON-string form.
 * returns null on any shape mismatch — caller treats as "no codex auth". */
export function parseCodexAuthBody(raw: string): CodexAuthBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const v = parsed as Record<string, unknown>;
  if (v.auth_mode !== "chatgpt") return null;
  const tokens = v.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const t = tokens as Record<string, unknown>;
  if (typeof t.access_token !== "string" || t.access_token.length === 0) return null;
  if (typeof t.refresh_token !== "string" || t.refresh_token.length === 0) return null;
  return {
    auth_mode: "chatgpt",
    ...(typeof v.refresh_rejected_at === "string"
      ? { refresh_rejected_at: v.refresh_rejected_at }
      : {}),
    tokens: {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      ...(typeof t.id_token === "string" ? { id_token: t.id_token } : {}),
      ...(typeof t.account_id === "string" ? { account_id: t.account_id } : {}),
    },
    ...(typeof v.last_refresh === "string" ? { last_refresh: v.last_refresh } : {}),
  };
}

/** serialize a CodexAuthBody to its canonical form (what the action expects in env). */
export function stringifyCodexAuthBody(body: CodexAuthBody): string {
  return `${JSON.stringify(body, null, 2)}\n`;
}

const ACCESS_TOKEN_MARGIN_MS = 60 * 60 * 1000;
const STALE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/** whether a run starting now should get a rotated chain rather than this one.
 * an unreadable exp counts as expired; a session older than a week is refreshed
 * proactively, matching the Codex CLI's own ~8-day staleness rule. */
export function codexNeedsRefresh(body: CodexAuthBody, now = Date.now()): boolean {
  if (body.refresh_rejected_at) return false;
  const exp = decodeJwtExpMs(body.tokens.access_token);
  if (exp === null) return true;
  if (exp - now < ACCESS_TOKEN_MARGIN_MS) return true;
  if (body.last_refresh) {
    const last = Date.parse(body.last_refresh);
    if (Number.isFinite(last) && now - last > STALE_SESSION_MS) return true;
  }
  return false;
}
