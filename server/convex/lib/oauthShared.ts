// Ported from action/utils/oauthShared.ts. Buffer swapped for atob so it runs
// in the Convex runtime; otherwise unchanged. Keep in sync when merging upstream.

import { base64UrlToUtf8 } from "./base64";

/**
 * Thrown when an OAuth provider rejects a refresh token (4xx).
 *
 * `chainIsDead` is decided by the CALLER, because providers disagree about how
 * to say it: OpenAI nests an object and discriminates on `error.code`
 * (`token_expired`). A rejection we cannot classify — a CDN error page in
 * front of the token endpoint, say — is NOT dead: latching there would retire
 * a working credential over a transient edge event.
 */
export class OAuthInvalidGrantError extends Error {
  public readonly status: number;
  public readonly chainIsDead: boolean;
  constructor(provider: string, status: number, body: string, chainIsDead: boolean) {
    super(`${provider} token refresh failed: ${status} ${body}`);
    this.name = "OAuthInvalidGrantError";
    this.status = status;
    this.chainIsDead = chainIsDead;
  }
}

/** parse a token-endpoint error body, or null when it is not a JSON object. */
export function parseOAuthErrorBody(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // non-JSON body: unclassifiable, so the caller treats it as retryable.
  }
  return null;
}

/** decode a JWT payload's `exp` claim in ms since epoch, or null when the token
 * isn't a parseable JWT or has no `exp`. Unverified: a freshness hint only. */
export function decodeJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  let payload: { exp?: unknown };
  try {
    payload = JSON.parse(base64UrlToUtf8(parts[1]));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  return payload.exp * 1000;
}
