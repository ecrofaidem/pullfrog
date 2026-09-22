// The one sentence at HEAD. Derived from the server's health query, the same
// subscription on every view, so no two tabs can disagree.

import type { HealthData } from "@server/health";
import type { CodexPoolAccountStatus } from "../../../utils/codexPoolProtocol";
import { relative } from "./format";

export type HealthKind = "ok" | "warn" | "cut" | "missing";

export interface Health {
  kind: HealthKind;
  line: string;
  detail?: string;
  /** the newest failed run's Actions log, when the failures are not credential failures */
  failedUrl?: string;
  /** whether the chain has ever rotated; false is the trial's most important signal */
  rotated: boolean;
}

/** "29% of the weekly limit left, resets in 3d 14h" from the usage row the server refreshes. */
export function describeUsage(usage: HealthData["usage"], now: number | null): string | null {
  if (!usage) return null;
  const left = 100 - usage.usedPercent;
  const days = Math.round(usage.windowSeconds / 86_400);
  const window = days >= 6 && days <= 8 ? "weekly" : days === 1 ? "daily" : `${Math.round(usage.windowSeconds / 3600)}h`;
  let reset = "";
  if (now !== null && usage.resetAt * 1000 > now) {
    const h = Math.round((usage.resetAt * 1000 - now) / 3_600_000);
    reset = h >= 48 ? `, resets in ${Math.floor(h / 24)}d ${h % 24}h` : h >= 1 ? `, resets in ${h}h` : ", resets within the hour";
  }
  return `${left}% of the ${window} limit left${reset}`;
}

export function reseedCommand(): string {
  return `PULLFROG_API_URL=${import.meta.env.VITE_CONVEX_SITE_URL} npx pullfrog auth codex`;
}

export function deriveHealth(data: HealthData, now: number | null): Health {
  const { chain, recent } = data;

  if (data.codexPool?.pool?.enabled) {
    const pool = data.codexPool;
    const accounts = pool.accounts.filter((account) => pool.pool!.accountIds.includes(account.id));
    const idle = accounts.filter((account) => account.enabled && account.authState === "ready" && !account.busy);
    const available = idle.filter((account) => currentPoolQuota(account, now) && account.quota?.result.status === "available");
    const unknown = idle.filter((account) => !currentPoolQuota(account, now)).length;
    const cached = available.some((account) => !freshPoolQuota(account, now));
    const busy = accounts.filter((account) => account.busy).length;
    const needsLogin = accounts.filter((account) => account.enabled && account.authState !== "ready").length;
    const availability = available.length === 0 && unknown > 0
      ? `${accounts.length} Codex accounts · ${unknown} awaiting quota check`
      : `${available.length} of ${accounts.length} Codex accounts available${cached ? " at last check" : ""}${unknown ? ` · ${unknown} awaiting quota check` : ""}`;
    return {
      kind: available.length ? "ok" : needsLogin === accounts.length && accounts.length > 0 ? "cut" : "warn",
      rotated: false,
      line: `${availability}${busy ? ` · ${busy} busy` : ""}${needsLogin ? ` · ${needsLogin} need sign-in` : ""}`,
      detail: "Availability is based on the latest quota checks. Quota is checked again before each run.",
    };
  }

  if (!chain) {
    return {
      kind: "missing",
      rotated: false,
      line: "No ChatGPT login saved",
      detail: "Runs use the OPENAI_API_KEY secret if it exists. Otherwise every run fails at the start.",
    };
  }
  if (chain.refreshRejectedAt) {
    return {
      kind: "cut",
      rotated: chain.lastRefreshAt !== undefined,
      line: `ChatGPT login rejected ${relative(chain.refreshRejectedAt, now)}`,
      detail: chain.refreshRejectedReason
        ? `OpenAI rejected it (${chain.refreshRejectedReason}). Every run fails until someone signs in again.`
        : "OpenAI rejected it. Every run fails until someone signs in again.",
    };
  }

  const rotated = chain.lastRefreshAt !== undefined;
  const settled = recent.filter((r) => r.status === "failed" || r.status === "completed").slice(0, 3);
  if (settled.length >= 2 && settled.every((r) => r.status === "failed")) {
    const newest = settled.find((r) => r.htmlUrl);
    return {
      kind: "warn",
      rotated,
      line: `Last ${settled.length} runs failed`,
      detail: "The ChatGPT login works, so the login is not the cause. Open the newest failed run's log.",
      ...(newest?.htmlUrl ? { failedUrl: newest.htmlUrl } : {}),
    };
  }

  const chainPart = rotated
    ? `login renewed ${relative(chain.lastRefreshAt!, now)}`
    : `login saved ${relative(chain.updatedAt, now)}, not renewed yet`;
  const last = recent[0];
  const parts = [chainPart];
  const usageLine = describeUsage(data.usage, now);
  if (usageLine) parts.push(usageLine);
  if (last) parts.push(`last run ${relative(last.createdAt, now)}`);
  return { kind: "ok", rotated, line: parts.join(" · ") };
}

/** A startup cache expiry does not erase the last reported usage for this window. */
function currentPoolQuota(account: CodexPoolAccountStatus, now: number | null): boolean {
  const quota = account.quota;
  if (!quota || quota.result.status === "unknown" || !Number.isFinite(quota.observedAt)) return false;
  if (now === null) return quota.fresh;
  return quota.observedAt <= now &&
    !("weekly" in quota.result && quota.result.weekly && quota.result.weekly.resetAt * 1000 <= now);
}

function freshPoolQuota(account: CodexPoolAccountStatus, now: number | null): boolean {
  return currentPoolQuota(account, now) && account.quota!.fresh &&
    (now === null || now - account.quota!.observedAt < 60_000);
}

export function describePoolAccount(account: CodexPoolAccountStatus, now: number | null): string {
  const quota = account.quota;
  let state = "Idle";
  if (!account.enabled) state = account.busy ? "Disabled · current run still finishing" : "Disabled";
  else if (account.busy) state = "Busy · current run still finishing";
  else if (account.authState !== "ready") state = account.authState === "uncertain" ? "Sign in again · last tokens were not recovered" : "Sign in again · login rejected";
  else if (currentPoolQuota(account, now)) {
    if (quota!.result.status === "authentication") state = "Usage request rejected";
    else if (quota!.result.status === "provider_denied") state = "Provider limit reached";
    else if (quota!.result.status === "exhausted") state = "Weekly limit reached";
    else if (quota!.result.status === "available") state = freshPoolQuota(account, now) ? "Available" : "Available at last check";
  }

  if (!quota) return `${state} · quota not checked yet`;
  const weekly = "weekly" in quota.result ? quota.result.weekly : undefined;
  const parts = [state];
  if (weekly) {
    parts.push(`${Math.ceil(100 - weekly.usedPercent)}% weekly remaining`);
    parts.push(now !== null && weekly.resetAt * 1000 <= now
      ? "reset passed; awaiting quota check"
      : `resets ${new Date(weekly.resetAt * 1000).toLocaleString()}`);
  } else if (quota.result.status === "unknown") {
    parts.push("quota could not be checked");
  }
  parts.push(`checked ${relative(quota.observedAt, now)}`);
  return parts.join(" · ");
}
