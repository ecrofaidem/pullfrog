/** Provider-neutral weekly evidence. Percentages remain raw until rendering. */
export interface CodexWeeklyUsage {
  plan?: string;
  usedPercent: number;
  windowSeconds: number;
  resetAt: number; // Unix seconds; observation timestamps below are milliseconds.
}

export type CodexQuotaResult =
  | { status: "available" | "exhausted"; weekly: CodexWeeklyUsage }
  | { status: "authentication" }
  | { status: "provider_denied"; weekly?: CodexWeeklyUsage }
  | { status: "unknown"; reason: "malformed" | "http" | "timeout" | "network" | "aborted" };

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Supports /wham/usage and the native Codex RateLimitSnapshot (minutes). */
export function parseCodexQuota(payload: unknown, now = Date.now()): CodexQuotaResult {
  const data = object(payload);
  const limits = object(data?.rate_limit);
  const native = limits === undefined;
  const windows = native
    ? [object(data?.primary), object(data?.secondary)]
    : [object(limits.primary_window), object(limits.secondary_window)];
  const weeklyWindows = windows.filter((item) => native
    ? item?.window_minutes === 10080 : item?.limit_window_seconds === 604800);
  const window = weeklyWindows.length === 1 ? weeklyWindows[0] : undefined;
  const resetAt = native ? window?.resets_at : window?.reset_at;
  const denied = limits?.allowed === false || limits?.limit_reached === true || data?.spend_control_reached === true;
  let weekly: CodexWeeklyUsage | undefined;
  if (window && typeof window.used_percent === "number" && Number.isFinite(window.used_percent) &&
      window.used_percent >= 0 && window.used_percent <= 100 &&
      typeof resetAt === "number" && Number.isSafeInteger(resetAt) && resetAt * 1000 > now &&
      resetAt <= 8_640_000_000_000) {
    weekly = {
      ...(typeof data?.plan_type === "string" ? { plan: data.plan_type } : {}),
      usedPercent: window.used_percent, windowSeconds: 604800, resetAt,
    };
  }
  if (denied) return { status: "provider_denied", ...(weekly ? { weekly } : {}) };
  if (!weekly) return { status: "unknown", reason: "malformed" };
  return { status: weekly.usedPercent < 100 ? "available" : "exhausted", weekly };
}

export interface CodexQuotaObservation {
  generation: number;
  credentialVersion: number;
  observedAt: number;
  result: CodexQuotaResult;
}

export function isFreshCodexQuota(
  observation: CodexQuotaObservation | null | undefined,
  identity: { generation: number; credentialVersion: number },
  now = Date.now(),
): boolean {
  if (!observation || observation.generation !== identity.generation ||
      observation.credentialVersion !== identity.credentialVersion ||
      !Number.isFinite(observation.observedAt) || observation.observedAt > now ||
      now - observation.observedAt >= 60_000 || observation.result.status === "unknown") return false;
  return !("weekly" in observation.result && observation.result.weekly &&
    observation.result.weekly.resetAt * 1000 <= now);
}

/** One usage read; its caller owns OAuth refresh and the total preflight budget. */
export async function probeCodexQuota(args: {
  accessToken: string;
  accountId?: string;
  deadline: number;
  signal?: AbortSignal;
}): Promise<CodexQuotaResult> {
  const remaining = Math.min(20_000, args.deadline - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) return { status: "unknown", reason: "timeout" };
  if (args.signal?.aborted) return { status: "unknown", reason: "aborted" };
  const controller = new AbortController();
  let onAbort: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<CodexQuotaResult>((resolve) => {
    onAbort = () => {
      controller.abort();
      resolve({ status: "unknown", reason: "aborted" });
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "unknown", reason: "timeout" });
    }, remaining);
  });
  const read = async (): Promise<CodexQuotaResult> => {
    try {
      const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          ...(args.accountId ? { "chatgpt-account-id": args.accountId } : {}),
          Accept: "application/json",
          "User-Agent": "pullfrog-fork",
        },
        signal: controller.signal,
      });
      if (response.status === 401) return { status: "authentication" };
      if (response.status === 403) return { status: "provider_denied" };
      if (!response.ok && response.status !== 429) return { status: "unknown", reason: "http" };
      let payload: unknown;
      try { payload = await response.json(); }
      catch { return { status: "unknown", reason: "malformed" }; }
      const result = parseCodexQuota(payload);
      if (response.status === 429 && result.status !== "exhausted" && result.status !== "provider_denied") {
        return { status: "unknown", reason: "http" };
      }
      return result;
    } catch {
      return { status: "unknown", reason: "network" };
    }
  };
  try { return await Promise.race([stopped, read()]); }
  finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onAbort);
  }
}
