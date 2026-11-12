// Everything the Usage page derives from the raw report: burn rates, the pool's
// coverage until the next reset, cost per run, weekly throughput. Pure functions
// of (report, now) so the page recomputes on the shared clock and tests can pin
// the clock.
//
// Units: a "point" is one percentage point of the first pool account's weekly
// limit. Other accounts are converted through their measured capacity factor,
// so demand stays comparable when the pool falls back to a smaller plan.

import type { UsageAccount, UsageReport, UsageRun, UsageSample } from "@server/usageReport";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
const STEP = 15 * 60_000;

export type AccountId = UsageAccount["id"];

/** percentage points an account spent inside [from, to]; a fresh window counts from zero */
export function spent(samples: UsageSample[], from: number, to: number): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const s = samples[i]!;
    if (s.at <= from) continue;
    if (s.at > to) break;
    const fresh = s.resetAt > prev.resetAt + HOUR;
    total += fresh ? s.usedPercent : Math.max(0, s.usedPercent - prev.usedPercent);
  }
  return total;
}

/**
 * the account's used % at t from its last reading. An exhausted window empties
 * at its reset; a denial holds until a newer reading says otherwise, since it
 * may carry an older window's reset time.
 */
export function usedAt(samples: UsageSample[], t: number): number | undefined {
  let last: UsageSample | undefined;
  for (const s of samples) {
    if (s.at > t) break;
    last = s;
  }
  if (!last) return undefined;
  if (last.status === "provider_denied") return 100;
  return last.resetAt <= t ? 0 : last.status === "exhausted" ? 100 : last.usedPercent;
}

export interface Capacity {
  /** this account's 1% in points of the first account's limit */
  factor: number;
  measured: boolean;
}

/**
 * tokens per point on each account, relative to the first; 1 until both have
 * enough history. Tokens count every repo the account served, since its
 * percentage moves for all of them.
 */
export function capacities(report: UsageReport, now: number): Map<AccountId, Capacity> {
  const perPoint = (account: UsageAccount): number | undefined => {
    const points = spent(account.samples, report.since, now);
    return account.servedRuns >= 5 && points >= 3 ? account.servedTokens / points : undefined;
  };
  const base = report.accounts[0] ? perPoint(report.accounts[0]) : undefined;
  return new Map(report.accounts.map((account, i) => {
    const own = perPoint(account);
    if (i === 0) return [account.id, { factor: 1, measured: base !== undefined }];
    return [account.id, base !== undefined && own !== undefined
      ? { factor: own / base, measured: true } : { factor: 1, measured: false }];
  }));
}

function firstReading(report: UsageReport): number | undefined {
  const firsts = report.accounts.flatMap((a) => (a.samples[0] ? [a.samples[0].at] : []));
  return firsts.length ? Math.min(...firsts) : undefined;
}

export interface Pace {
  /** points per hour, or null when too little served time exists to say */
  rate: number | null;
  servedHours: number;
  dryHours: number;
}

/**
 * pool demand in points per hour over [now - span, now]. Hours with no account
 * left are left out: nothing could be spent then, so counting them would read
 * a lockout as low demand. The rate needs `minimum` of served time.
 */
export function demand(
  report: UsageReport, caps: Map<AccountId, Capacity>, now: number, span: number, minimum: number,
): Pace {
  const first = firstReading(report);
  if (first === undefined) return { rate: null, servedHours: 0, dryHours: 0 };
  const from = Math.max(now - span, first);
  const dry = pastCoverage(report, from, now).filter((s) => s.accountId === null)
    .reduce((n, s) => n + s.to - s.from, 0);
  const served = now - from - dry;
  const points = report.accounts.reduce(
    (n, a) => n + (caps.get(a.id)?.factor ?? 1) * spent(a.samples, from, now), 0);
  return { rate: served < minimum ? null : points / (served / HOUR), servedHours: served / HOUR, dryHours: dry / HOUR };
}

export interface Lane {
  id: AccountId;
  used: number;
  resetAt: number;
  factor: number;
  /** a plan change that takes effect at the account's next reset */
  factorAfterReset?: number | undefined;
}

/** each enabled account's position now, in the order runs try them */
export function lanesAt(report: UsageReport, caps: Map<AccountId, Capacity>, now: number): Lane[] {
  return report.accounts.flatMap((a) => {
    const last = a.samples.at(-1);
    if (!a.enabled || !last) return [];
    // a denied account stays out for the whole projection
    if (last.status === "provider_denied") return [{ id: a.id, used: 100, resetAt: Infinity, factor: caps.get(a.id)?.factor ?? 1 }];
    let used = last.status === "exhausted" ? 100 : last.usedPercent;
    let { resetAt } = last;
    while (resetAt <= now) {
      used = 0;
      resetAt += WEEK;
    }
    return [{ id: a.id, used, resetAt, factor: caps.get(a.id)?.factor ?? 1 }];
  });
}

/** null is a stretch with no account left; undefined is a stretch with no readings */
export interface Segment {
  from: number;
  to: number;
  accountId: AccountId | null | undefined;
}

function pushSegment(segments: Segment[], from: number, to: number, accountId: Segment["accountId"]) {
  const last = segments.at(-1);
  if (last && last.accountId === accountId && last.to === from) last.to = to;
  else segments.push({ from, to, accountId });
}

export interface Projection {
  until: number;
  segments: Segment[];
  /** when each account first reaches 100% */
  runsOut: Map<AccountId, number>;
  gapHours: number;
  firstGap: number | undefined;
  /** used % per account along the way, for the dashed half of the history chart */
  paths: Map<AccountId, { at: number; used: number }[]>;
}

/** the projection runs to the latest pending reset, at most eight days out */
export function horizon(lanes: Lane[], now: number): number {
  const pending = lanes.map((l) => l.resetAt).filter(Number.isFinite);
  if (!pending.length) return now + DAY;
  return Math.min(Math.max(...pending), now + 8 * DAY);
}

/**
 * steps demand forward, serving it from the first account with headroom, as
 * the pool does. Steps end at resets, and a step the pool cannot fully serve is
 * split where the last account runs out.
 */
export function project(lanes: Lane[], rate: number, now: number, until: number): Projection {
  const state = lanes.map((l) => ({ ...l }));
  const segments: Segment[] = [];
  const runsOut = new Map<AccountId, number>();
  const paths = new Map(state.map((l) => [l.id, [{ at: now, used: l.used }]]));
  for (let t = now; t < until;) {
    const end = Math.min(t + STEP, until, ...state.map((l) => l.resetAt).filter((r) => r > t));
    const total = (rate * (end - t)) / HOUR;
    let need = total;
    let cursor = t;
    // each account gets the slice of the step its share of demand covers
    for (const l of state) {
      if (need <= 1e-9 && total > 0) break;
      if (l.used >= 100) continue;
      if (total === 0) {
        pushSegment(segments, t, end, l.id);
        cursor = end;
        break;
      }
      const take = Math.min(need, (100 - l.used) * l.factor);
      l.used += take / l.factor;
      need -= take;
      const servedTo = end - (need / total) * (end - t);
      if (servedTo > cursor) pushSegment(segments, cursor, servedTo, l.id);
      cursor = servedTo;
      if (l.used >= 100 - 1e-9) {
        l.used = 100;
        if (!runsOut.has(l.id)) runsOut.set(l.id, servedTo);
      }
    }
    if (cursor < end) pushSegment(segments, cursor, end, null);
    for (const l of state) paths.get(l.id)!.push({ at: end, used: l.used });
    t = end;
    for (const l of state) {
      if (t >= l.resetAt) {
        l.used = 0;
        l.resetAt += WEEK;
        paths.get(l.id)!.push({ at: t, used: 0 });
        if (l.factorAfterReset !== undefined) {
          l.factor = l.factorAfterReset;
          l.factorAfterReset = undefined;
        }
      }
    }
  }
  const gaps = segments.filter((s) => s.accountId === null);
  return {
    until, segments, runsOut, paths,
    gapHours: gaps.reduce((n, s) => n + (s.to - s.from) / HOUR, 0),
    firstGap: gaps[0]?.from,
  };
}

/** which account had headroom at each step of the past, from the readings */
export function pastCoverage(report: UsageReport, from: number, to: number): Segment[] {
  const segments: Segment[] = [];
  const enabled = report.accounts.filter((a) => a.enabled);
  for (let t = from; t < to; t += STEP) {
    const used = enabled.map((a) => ({ id: a.id, used: usedAt(a.samples, t) }));
    const known = used.filter((u) => u.used !== undefined);
    const accountId = known.length === 0 ? undefined : (known.find((u) => u.used! < 100)?.id ?? null);
    pushSegment(segments, t, Math.min(t + STEP, to), accountId);
  }
  return segments;
}

export interface ResetEvent {
  at: number;
  accountId: AccountId;
  /** a reset spent by hand before the scheduled one */
  early: boolean;
}

export function resets(report: UsageReport): ResetEvent[] {
  return report.accounts.flatMap((a) => a.samples.flatMap((s, i) => {
    const prev = a.samples[i - 1];
    if (!prev || s.resetAt <= prev.resetAt + HOUR) return [];
    return [{ at: s.at, accountId: a.id, early: s.at < prev.resetAt }];
  }));
}

export interface RunCost {
  run: UsageRun;
  /** points of the first account's limit */
  points: number;
  /** from the account's average cost per token, when overlapping runs (in any repo) blur the direct reading */
  estimated: boolean;
}

export function runCosts(report: UsageReport, caps: Map<AccountId, Capacity>, now: number): RunCost[] {
  const perToken = new Map(report.accounts.map((a) =>
    [a.id, a.servedTokens > 0 ? spent(a.samples, report.since, now) / a.servedTokens : undefined]));
  return report.runs.flatMap((run): RunCost[] => {
    if (!run.accountId || run.completedAt === undefined) return [];
    const factor = caps.get(run.accountId)?.factor ?? 1;
    const account = report.accounts.find((a) => a.id === run.accountId);
    const start = account && [...account.samples].reverse().find((s) => s.at <= run.createdAt);
    // a reset during the run puts its two readings in different windows
    const resetDuring = !account || start === undefined || start.resetAt <= run.completedAt ||
      resets(report).some((r) => r.accountId === run.accountId && r.at > run.createdAt && r.at <= run.completedAt!);
    if (!run.overlapped && !resetDuring && run.quotaStart !== undefined && run.quotaEnd !== undefined && run.quotaEnd >= run.quotaStart) {
      return [{ run, points: (run.quotaEnd - run.quotaStart) * factor, estimated: false }];
    }
    const rate = perToken.get(run.accountId);
    return rate !== undefined && run.tokens > 0 ? [{ run, points: run.tokens * rate * factor, estimated: true }] : [];
  });
}

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface CostGroup {
  speed: string;
  subagents: boolean;
  runs: number;
  perRun: number;
  per1kLines: number | undefined;
  perMTokens: number | undefined;
}

/** median cost per configuration; per-line figures come from full reviews only */
export function costGroups(costs: RunCost[]): CostGroup[] {
  const groups = new Map<string, RunCost[]>();
  for (const c of costs) {
    if (c.run.speed === undefined) continue;
    const key = `${c.run.speed}|${(c.run.subagents ?? 0) > 0}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const [speed, subagents] = key.split("|") as [string, string];
    const reviews = list.filter((c) => c.run.kind === "review" && (c.run.lines ?? 0) > 0);
    const tokened = list.filter((c) => c.run.tokens > 0);
    return {
      speed, subagents: subagents === "true", runs: list.length,
      perRun: median(list.map((c) => c.points))!,
      per1kLines: median(reviews.map((c) => (c.points / c.run.lines!) * 1000)),
      perMTokens: median(tokened.map((c) => (c.points / c.run.tokens) * 1e6)),
    };
  }).sort((a, b) => b.runs - a.runs);
}

export interface WeekRow {
  from: number;
  to: number;
  runs: number;
  prs: number;
  lines: number;
  tokens: number;
  /** undefined when the week predates the readings */
  noCapacityHours: number | undefined;
  resetsUsed: number;
}

/** rolling seven-day buckets ending now, newest first */
export function weeks(report: UsageReport, coverage: Segment[], now: number, count = 4): WeekRow[] {
  const early = resets(report).filter((r) => r.early);
  const first = firstReading(report);
  return Array.from({ length: count }, (_, i) => {
    const to = now - i * WEEK;
    const from = to - WEEK;
    const runs = report.runs.filter((r) => r.createdAt >= from && r.createdAt < to);
    const prLines = new Map<number, number>();
    for (const r of runs) {
      if (r.prNumber !== undefined && r.lines !== undefined) {
        prLines.set(r.prNumber, Math.max(prLines.get(r.prNumber) ?? 0, r.lines));
      }
    }
    const gap = coverage.filter((s) => s.accountId === null)
      .reduce((n, s) => n + Math.max(0, Math.min(s.to, to) - Math.max(s.from, from)), 0);
    return {
      from, to, runs: runs.length,
      prs: new Set(runs.flatMap((r) => (r.prNumber === undefined ? [] : [r.prNumber]))).size,
      lines: [...prLines.values()].reduce((n, l) => n + l, 0),
      tokens: runs.reduce((n, r) => n + r.tokens, 0),
      noCapacityHours: first === undefined || first > to ? undefined : gap / HOUR,
      resetsUsed: early.filter((r) => r.at >= from && r.at < to).length,
    };
  });
}
