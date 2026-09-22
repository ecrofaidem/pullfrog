/** Native Codex's host-managed mode: the child has no refresh-chain authority. */
export interface CodexAccessAuth {
  auth_mode: "chatgptAuthTokens";
  tokens: {
    access_token: string;
    id_token: string;
    account_id: string;
    refresh_token: "";
  };
  last_refresh?: string;
}

/** Keep this separate from enrollment and legacy OAuth writeback validation. */
export function parseCodexAccessAuth(raw: string): CodexAccessAuth | null {
  let body;
  try { body = JSON.parse(raw); } catch { return null; }
  if (body?.auth_mode !== "chatgptAuthTokens" || !body.tokens ||
      body.tokens.refresh_token !== "" ||
      ![body.tokens.access_token, body.tokens.id_token, body.tokens.account_id]
        .every((value) => typeof value === "string" && value.length > 0)) return null;
  return {
    auth_mode: "chatgptAuthTokens",
    tokens: {
      access_token: body.tokens.access_token, id_token: body.tokens.id_token,
      account_id: body.tokens.account_id, refresh_token: "",
    },
    ...(typeof body.last_refresh === "string" ? { last_refresh: body.last_refresh } : {}),
  };
}
