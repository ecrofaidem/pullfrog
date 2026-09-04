// FORK: the ChatGPT subscription's remaining limit, for the comment footer.
//
// The Codex backend answers `GET /wham/usage` with the same numbers the Codex
// CLI's status screen shows: per window, the percent used and when it resets.
// It is read once per run with the subscription chain the run already holds,
// early and without blocking, so every footer built later can render it
// synchronously. API-key runs have no chain and render nothing.

import { log } from "./cli.ts";
import { parseCodexAuthBody } from "./codexOAuth.ts";

export interface CodexUsage {
  plan: string | undefined;
  usedPercent: number;
  windowSeconds: number;
  resetAt: number; // unix seconds
}

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

let primed: Promise<CodexUsage | null> | undefined;
let current: CodexUsage | null = null;

/** start the read; safe to call more than once. */
export function primeCodexUsage(): Promise<CodexUsage | null> {
  primed ??= fetchCodexUsage()
    .catch((err) => {
      log.info(`» codex usage read failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    })
    .then((u) => {
      current = u;
      return u;
    });
  return primed;
}

/** whatever the read produced so far; null before it lands or when there is no chain. */
export function currentCodexUsage(): CodexUsage | null {
  return current;
}

interface Window {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

function accountIdFromToken(token: string): string | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = claims["https://api.openai.com/auth"];
    if (auth && typeof auth === "object" && "chatgpt_account_id" in auth) {
      const id = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id;
      return typeof id === "string" ? id : undefined;
    }
  } catch {
    // not a JWT we can read
  }
  return undefined;
}

async function fetchCodexUsage(): Promise<CodexUsage | null> {
  const raw = process.env.CODEX_AUTH_JSON;
  if (!raw) {
    log.info("» codex usage: no CODEX_AUTH_JSON in env, skipping");
    return null;
  }
  const body = parseCodexAuthBody(raw);
  if (!body || body.refresh_rejected_at) return null;
  const accountId =
    body.tokens.account_id ??
    accountIdFromToken(body.tokens.id_token ?? "") ??
    accountIdFromToken(body.tokens.access_token);
  const response = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${body.tokens.access_token}`,
      ...(accountId ? { "chatgpt-account-id": accountId } : {}),
      Accept: "application/json",
      "User-Agent": "pullfrog-fork",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok && response.status !== 429) {
    log.info(`» codex usage: ${response.status} from ${USAGE_URL}`);
    return null;
  }
  const data = (await response.json()) as {
    plan_type?: string;
    rate_limit?: { primary_window?: Window | null; secondary_window?: Window | null };
  };
  // the longest window is the one people budget against (weekly on every plan seen so far)
  const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].filter(
    (w): w is Window => !!w && typeof w.used_percent === "number" && typeof w.limit_window_seconds === "number"
  );
  const longest = windows.sort((a, b) => b.limit_window_seconds! - a.limit_window_seconds!)[0];
  if (!longest) {
    log.info("» codex usage: response carried no rate-limit window");
    return null;
  }
  return {
    plan: data.plan_type,
    usedPercent: Math.max(0, Math.min(100, Math.round(longest.used_percent!))),
    windowSeconds: longest.limit_window_seconds!,
    resetAt: longest.reset_at ?? 0,
  };
}

/** "▰▰▰▰▰▰▰▱▱▱ 29% of the weekly limit left · resets in 3d 14h" */
export function renderCodexUsage(usage: CodexUsage, now = Date.now()): string {
  const left = 100 - usage.usedPercent;
  const filled = Math.round(left / 10);
  const bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
  const days = Math.round(usage.windowSeconds / 86_400);
  const windowName = days >= 6 && days <= 8 ? "weekly" : days === 1 ? "daily" : `${Math.round(usage.windowSeconds / 3600)}h`;
  const secs = usage.resetAt * 1000 - now;
  let reset = "";
  if (usage.resetAt && secs > 0) {
    const h = Math.round(secs / 3_600_000);
    reset = h >= 48 ? ` · resets in ${Math.floor(h / 24)}d ${h % 24}h` : h >= 1 ? ` · resets in ${h}h` : " · resets within the hour";
  }
  return `${bar} ${left}% of the ${windowName} limit left${reset}`;
}
