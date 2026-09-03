// The one sentence at HEAD. Derived from the server's health query, the same
// subscription on every view, so no two tabs can disagree.

import type { HealthData } from "@server/health";
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
