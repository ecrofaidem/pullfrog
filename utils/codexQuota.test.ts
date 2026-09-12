import { describe, expect, it } from "vitest";
import { parseCodexQuota } from "./codexQuota.ts";

const weekly = { used_percent: 99.6, limit_window_seconds: 604800, reset_at: 2_000_000_000 };

describe("weekly Codex quota", () => {
  it("keeps a lone primary weekly window at 99.6% available", () => {
    expect(parseCodexQuota({ plan_type: "pro", rate_limit: { primary_window: weekly } })).toEqual({
      status: "available",
      weekly: { plan: "pro", usedPercent: 99.6, windowSeconds: 604800, resetAt: 2_000_000_000 },
    });
  });
});

it.each([
  { rate_limit: { secondary_window: weekly, primary_window: { used_percent: 100, limit_window_seconds: 18000 } } },
  { primary: { used_percent: 99.6, window_minutes: 10080, resets_at: 2_000_000_000 } },
])("recognizes the weekly duration in supported slots and units", (payload) => {
  expect(parseCodexQuota(payload)).toMatchObject({ status: "available", weekly: { usedPercent: 99.6 } });
});

it.each([undefined, null, {}, { rate_limit: [] }, ...[NaN, Infinity, -1, 100.1, "25"].map((used_percent) => ({ rate_limit: { primary_window: { ...weekly, used_percent } } })), ...[undefined, NaN, Infinity, -1, 0, "2000000000", 1_700_000_000].map((reset_at) => ({ rate_limit: { primary_window: { ...weekly, reset_at } } }))])("does not invent capacity from malformed or reset-crossed evidence", (payload) => {
  expect(parseCodexQuota(payload, 1_800_000_000_000)).toEqual({ status: "unknown", reason: "malformed" });
});

it("distinguishes exactly exhausted weekly quota from an explicit provider denial", () => {
  expect(parseCodexQuota({ rate_limit: { primary_window: { ...weekly, used_percent: 100 } } })).toMatchObject({ status: "exhausted" });
  expect(parseCodexQuota({ rate_limit: { allowed: false, primary_window: weekly } })).toMatchObject({ status: "provider_denied" });
  expect(parseCodexQuota({ rate_limit: { limit_reached: true } })).toEqual({ status: "provider_denied" });
});

it("reuses only fresh generation-bound evidence before reset", async () => {
  const { isFreshCodexQuota } = await import("./codexQuota.ts");
  const now = 1_800_000_000_000;
  const identity = { generation: 2, credentialVersion: 3 };
  const observation = { ...identity, observedAt: now - 59_999, result: parseCodexQuota({ rate_limit: { primary_window: weekly } }, now) };
  expect(isFreshCodexQuota(observation, identity, now)).toBe(true);
  for (const stale of [
    { ...observation, observedAt: now - 60_000 },
    { ...observation, observedAt: now + 1 },
    { ...observation, generation: 1 },
    { ...observation, credentialVersion: 2 },
    { ...observation, result: { status: "unknown", reason: "http" } as const },
    { ...observation, result: { status: "available", weekly: { usedPercent: 25, windowSeconds: 604800, resetAt: now / 1000 } } as const },
  ]) expect(isFreshCodexQuota(stale, identity, now)).toBe(false);
  expect(isFreshCodexQuota({ ...observation, result: { status: "exhausted", weekly: { usedPercent: 100, windowSeconds: 604800, resetAt: 2_000_000_000 } } }, identity, now)).toBe(true);
});

it("rounds only for rendering while retaining eligibility in the same observation", async () => {
  const { renderCodexUsage } = await import("./codexUsage.ts");
  const quota = parseCodexQuota({ rate_limit: { primary_window: weekly } }, 1_800_000_000_000);
  expect(quota.status).toBe("available");
  if (quota.status !== "available") throw new Error("expected available weekly quota");
  expect(renderCodexUsage({ ...quota.weekly, plan: quota.weekly.plan }, 1_800_000_000_000)).toMatch(/^▱{10} 0% of the weekly limit left/);
  expect(quota.weekly.usedPercent).toBe(99.6);
});
