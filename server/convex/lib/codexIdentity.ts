import { parseCodexAuthBody } from "./codexOAuth";

/** Validate a complete auth snapshot and reconcile every identity it contains.
 * JWT claims are identity hints, not signature verification or operator authority. */
export function getCodexProviderAccountId(raw: string): string | null {
  const body = parseCodexAuthBody(raw);
  if (!body || body.refresh_rejected_at || !body.tokens.access_token.trim() || !body.tokens.refresh_token.trim()) return null;
  const parsed = JSON.parse(raw) as { tokens: Record<string, unknown>; last_refresh?: unknown; refresh_rejected_at?: unknown };
  for (const field of ["account_id", "id_token"]) {
    const value = parsed.tokens[field];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) return null;
  }
  for (const value of [parsed.last_refresh, parsed.refresh_rejected_at]) {
    if (value !== undefined && typeof value !== "string") return null;
  }
  const identities: string[] = [];
  if (body.tokens.account_id) identities.push(body.tokens.account_id);
  for (const token of [body.tokens.access_token, body.tokens.id_token]) {
    if (!token) continue;
    try {
      const encoded = token.split(".")[1];
      if (!encoded) continue;
      const claims = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
      const auth = claims["https://api.openai.com/auth"];
      if (!auth || typeof auth !== "object") continue;
      const identity = (auth as Record<string, unknown>).chatgpt_account_id;
      if (identity !== undefined) {
        if (typeof identity !== "string" || !identity.trim()) return null;
        identities.push(identity);
      }
    } catch { /* Opaque tokens are valid when another field supplies identity. */ }
  }
  const identity = identities[0];
  return identity && identity === identity.trim() && identities.every((value) => value === identity) ? identity : null;
}
