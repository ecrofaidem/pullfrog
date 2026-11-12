import { describe, expect, it } from "vitest";
import type { UsageReport, UsageRun, UsageSample } from "../../../server/convex/usageReport";
import {
  capacities, DAY, demand, horizon, HOUR, lanesAt, pastCoverage, project, resets, runCosts, spent, usedAt, WEEK, weeks,
  type AccountId,
} from "./usage";

const now = Date.UTC(2026, 10, 12, 14, 0);
const A = "a1" as AccountId;
const B = "a2" as AccountId;
const sample = (hoursAgo: number, usedPercent: number, resetAt: number): UsageSample =>
  ({ at: now - hoursAgo * HOUR, usedPercent, resetAt, status: usedPercent < 100 ? "available" : "exhausted" });
const run = (over: Partial<UsageRun>): UsageRun => ({
  id: Math.random().toString() as UsageRun["id"], createdAt: now - HOUR, completedAt: now - HOUR + 600_000,
  status: "completed", kind: "review", prNumber: 1, prTitle: "t", htmlUrl: undefined, tokens: 1000,
  lines: undefined, accountId: A, quotaStart: undefined, quotaEnd: undefined, speed: "ultrafast", subagents: 0,
  overlapped: false, ...over,
});
const served = (runs: UsageRun[], id: AccountId) => {
  const mine = runs.filter((r) => r.accountId === id);
  return { servedRuns: mine.length, servedTokens: mine.reduce((n, r) => n + r.tokens, 0) };
};
const report = (samplesA: UsageSample[], samplesB: UsageSample[] = [], runs: UsageRun[] = []): UsageReport => ({
  since: now - 28 * DAY,
  poolEnabled: true,
  accounts: [
    { id: A, label: "Main", plan: "pro", enabled: true, samples: samplesA, ...served(runs, A) },
    { id: B, label: "Backup", plan: "plus", enabled: true, samples: samplesB, ...served(runs, B) },
  ],
  runs,
});

describe("spent", () => {
  it("adds rises, ignores drops, and counts a fresh window from zero", () => {
    const r1 = now + DAY;
    const r2 = r1 + WEEK;
    const s = [sample(10, 40, r1), sample(8, 50, r1), sample(6, 45, r1), sample(4, 5, r2), sample(2, 9, r2)];
    expect(spent(s, now - 11 * HOUR, now)).toBe(10 + 5 + 4);
    expect(spent(s, now - 5 * HOUR, now)).toBe(5 + 4);
  });

  it("reads zero once the last reading's window has passed", () => {
    expect(usedAt([sample(2, 80, now - HOUR)], now)).toBe(0);
    expect(usedAt([sample(2, 80, now + HOUR)], now)).toBe(80);
    expect(usedAt([sample(2, 80, now + HOUR)], now - 3 * HOUR)).toBeUndefined();
  });
});

describe("projection", () => {
  it("serves from the first account, falls back, then names the gap until a reset", () => {
    const lanes = [
      { id: A, used: 90, resetAt: now + 4 * DAY, factor: 1 },
      { id: B, used: 80, resetAt: now + 2 * DAY, factor: 0.5 },
    ];
    const p = project(lanes, 1, now, now + 4 * DAY);
    // A: 10 points at 1/h -> 10h; B: 20% at factor .5 = 10 points -> 10h more; gap until B resets at 48h
    expect(p.runsOut.get(A)).toBe(now + 10 * HOUR);
    expect(p.runsOut.get(B)).toBe(now + 20 * HOUR);
    expect(p.firstGap).toBe(now + 20 * HOUR);
    expect(p.segments.map((s) => [s.accountId, (s.to - s.from) / HOUR])).toEqual([
      [A, 10], [B, 10], [null, 28], [B, 48],
    ]);
    expect(p.gapHours).toBe(28);
  });

  it("rolls windows that already reset and measures demand in first-account points", () => {
    const r = report([sample(30, 20, now + DAY), sample(24, 30, now + DAY), sample(0, 54, now + DAY)],
      [sample(30, 50, now - HOUR)]);
    const caps = capacities(r, now);
    expect(demand(r, caps, now, DAY, 6 * HOUR).rate).toBe(1);
    expect(demand(r, caps, now, WEEK, 7 * DAY).rate).toBeNull();
    // the same 24 points spent in the 12 hours the pool had room is twice the rate
    const dry = report([sample(30, 20, now + DAY), sample(24, 30, now + DAY), sample(12, 100, now + DAY), sample(0, 100, now + DAY)],
      [sample(30, 100, now + DAY)]);
    expect(demand(dry, capacities(dry, now), now, DAY, 6 * HOUR)).toEqual({ rate: 70 / 12, servedHours: 12, dryHours: 12 });
    expect(lanesAt(r, caps, now).map((l) => [l.used, l.resetAt])).toEqual([[54, now + DAY], [0, now - HOUR + WEEK]]);
  });
});

describe("history", () => {
  it("finds the stretches with no headroom and the resets spent early", () => {
    const r1 = now + DAY;
    const r = report(
      [sample(10, 90, r1), sample(6, 100, r1), sample(3, 2, r1 + WEEK)],
      [sample(10, 100, now + 2 * DAY)],
    );
    const past = pastCoverage(r, now - 10 * HOUR, now);
    expect(past.map((s) => [s.accountId, (s.to - s.from) / HOUR])).toEqual([[A, 4], [null, 3], [A, 3]]);
    expect(resets(r)).toEqual([{ at: now - 3 * HOUR, accountId: A, early: true }]);
    const [week] = weeks(r, past, now, 1);
    expect(week).toMatchObject({ noCapacityHours: 3, resetsUsed: 1 });
  });
});

describe("run cost", () => {
  it("reads a lone run directly and estimates overlapping ones from tokens", () => {
    const r1 = now + DAY;
    const lone = run({ createdAt: now - 10 * HOUR, completedAt: now - 9 * HOUR, quotaStart: 10, quotaEnd: 13 });
    const x = run({ createdAt: now - 3 * HOUR, completedAt: now - 2 * HOUR, tokens: 3000, quotaStart: 13, quotaEnd: 20, overlapped: true });
    const y = run({ createdAt: now - 150 * 60_000, completedAt: now - HOUR, tokens: 1000, quotaStart: 14, quotaEnd: 21, overlapped: true });
    const r = report([sample(11, 10, r1), sample(0, 21, r1)], [], [lone, x, y]);
    const costs = runCosts(r, capacities(r, now), now);
    expect(costs.find((c) => c.run === lone)).toMatchObject({ points: 3, estimated: false });
    // 11 points over 5000 tokens
    expect(costs.find((c) => c.run === x)!.points).toBeCloseTo(6.6);
    expect(costs.find((c) => c.run === y)).toMatchObject({ estimated: true });
  });
});

describe("projection edges", () => {
  it("splits a step where the last account runs out, and stops at the latest reset", () => {
    const lanes = [{ id: A, used: 99.5, resetAt: now + 15 * 60_000, factor: 1 }];
    expect(horizon(lanes, now)).toBe(now + 15 * 60_000);
    const p = project(lanes, 4, now, horizon(lanes, now));
    expect(p.runsOut.get(A)).toBe(now + 7.5 * 60_000);
    expect(p.segments.map((s) => s.accountId)).toEqual([A, null]);
    expect(p.gapHours).toBeCloseTo(0.125);
  });

  it("applies a plan change only from the account's next reset", () => {
    const lanes = [{ id: B, used: 80, resetAt: now + 2 * HOUR, factor: 0.1, factorAfterReset: 1 }];
    const p = project(lanes, 1, now, now + 4 * HOUR);
    // 20% at factor .1 is 2 points: dry from 2h, which is the reset, then 1 point/h of a full-size account
    expect(p.runsOut.get(B)).toBe(now + 2 * HOUR);
    expect(p.paths.get(B)!.at(-1)!.used).toBeCloseTo(2);
  });

  it("treats a denied account as having no room", () => {
    const denied: UsageSample = { ...sample(1, 40, now + DAY), status: "provider_denied" };
    const r = report([denied]);
    expect(usedAt(r.accounts[0]!.samples, now)).toBe(100);
    expect(lanesAt(r, capacities(r, now), now)[0]!.used).toBe(100);
  });
});

describe("projection detail", () => {
  it("splits a step between accounts and draws the reset as an instant drop", () => {
    const lanes = [
      { id: A, used: 99.5, resetAt: now + 30 * 60_000, factor: 1 },
      { id: B, used: 0, resetAt: now + DAY, factor: 1 },
    ];
    const p = project(lanes, 4, now, now + 30 * 60_000);
    expect(p.segments.map((s) => [s.accountId, (s.to - s.from) / 60_000])).toEqual([[A, 7.5], [B, 22.5]]);
    const path = p.paths.get(A)!;
    expect(path.slice(-2)).toEqual([{ at: now + 30 * 60_000, used: 100 }, { at: now + 30 * 60_000, used: 0 }]);
  });
});

describe("round 3", () => {
  it("keeps a denial closed past the reset time it inherited", () => {
    const denied: UsageSample = { ...sample(1, 40, now - 2 * HOUR), status: "provider_denied" };
    const r = report([sample(5, 40, now - 2 * HOUR), denied]);
    expect(usedAt(r.accounts[0]!.samples, now)).toBe(100);
    expect(lanesAt(r, capacities(r, now), now)[0]).toMatchObject({ used: 100, resetAt: Infinity });
    expect(horizon(lanesAt(r, capacities(r, now), now), now)).toBe(now + DAY);
  });

  it("estimates a run that started before the first reading", () => {
    const early = run({ createdAt: now - 5 * HOUR, completedAt: now - 4 * HOUR, quotaStart: 10, quotaEnd: 20 });
    const r = report([sample(3, 20, now + DAY), sample(0, 30, now + DAY)], [], [early]);
    expect(runCosts(r, capacities(r, now), now)[0]).toMatchObject({ estimated: true });
  });

  it("estimates a run whose readings straddle a reset", () => {
    const r1 = now - 2 * HOUR;
    const straddle = run({ createdAt: now - 3 * HOUR, completedAt: now - HOUR, quotaStart: 10, quotaEnd: 20 });
    const r = report([sample(4, 10, r1), sample(0, 20, r1 + WEEK)], [], [straddle]);
    expect(runCosts(r, capacities(r, now), now)[0]).toMatchObject({ estimated: true });
  });
});
