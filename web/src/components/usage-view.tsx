// The Usage page body: verdict, coverage strips, history, cost per run and
// throughput, all derived from one report against the reader's clock.

import type { UsageReport } from "@server/usageReport";
import { HeadGlyph } from "~/components/glyphs";
import { CoverageStrips, DailyRuns, HistoryChart, Legend, seriesColor } from "~/components/usage-charts";
import { tokens } from "~/lib/format";
import {
  capacities, costGroups, DAY, demand, HOUR, horizon, lanesAt, pastCoverage, project, runCosts, WEEK, weeks,
  type AccountId, type Projection,
} from "~/lib/usage";

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dateParts = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

function dated(ms: number): string {
  const part = (type: string) => dateParts.formatToParts(ms).find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** "today 13:02", "tomorrow 09:50", "Fri 09:50", "Thu 19 Nov 13:24" */
function when(ms: number, now: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const diff = Math.round((day(ms) - day(now)) / DAY);
  const prefix = diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff > 1 && diff < 6 ? weekday.format(ms) : dated(ms);
  return `${prefix} ${clock.format(ms)}`;
}

function hours(h: number): string {
  const n = Math.round(h);
  return n < 48 ? `${n}h` : `${Math.floor(n / 24)}d ${n % 24}h`;
}

const pct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

export function Usage({ report, now }: { report: UsageReport; now: number }) {
  const base = report.accounts[0]!;
  const caps = capacities(report, now);
  const colorOf = new Map<AccountId, string>(report.accounts.map((a, i) => [a.id, seriesColor(i)]));
  const label = new Map(report.accounts.map((a) => [a.id, a.label]));
  const speedOf = new Map(report.accounts.map((a) => [a.id, [...report.runs].reverse().find((r) => r.accountId === a.id && r.speed)?.speed]));
  const lanes = lanesAt(report, caps, now);
  const until = horizon(lanes, now);
  const historyFrom = Math.max(now - WEEK, report.since);
  const past = pastCoverage(report, now - 4 * WEEK, now);
  const resetMarks = lanes.map((l) => ({ at: l.resetAt, label: `${label.get(l.id)} resets` }));
  const paces = [
    { name: "last 24h pace", span: 24, pace: demand(report, caps, now, DAY, 3 * HOUR) },
    { name: "7-day pace", span: 168, pace: demand(report, caps, now, WEEK, DAY) },
  ].map((p) => ({ ...p, projection: p.pace.rate === null ? null : project(lanes, p.pace.rate, now, until) }));
  const measured = paces.filter((p) => p.projection);
  const dry = measured.filter((p) => p.projection!.firstGap !== undefined);
  const state = !measured.length ? "missing" : dry.length === measured.length ? "cut" : dry.length ? "warn" : "ok";
  const atWeek = paces[1]!.projection;
  const smaller = report.accounts.filter((a, i) => i > 0 && a.plan && base.plan && a.plan !== base.plan);
  const upgraded = lanes.map((l) => (smaller.some((a) => a.id === l.id) ? { ...l, factorAfterReset: 1 } : l));

  /** "runs dry Mon 1:14 AM: 47h with nothing until Account 2 resets, 58h dry in all" */
  const gapSentence = (p: Projection): string => {
    const after = p.segments.find((s) => s.from > p.firstGap! && s.accountId);
    const first = ((after?.from ?? p.until) - p.firstGap!) / HOUR;
    return `runs dry ${when(p.firstGap!, now)}: ${hours(first)} with nothing` +
      (after ? ` until ${label.get(after.accountId!)} resets` : "") +
      (p.gapHours - first >= 1 ? `, ${hours(p.gapHours)} dry in all before ${when(p.until, now)}` : "");
  };
  const unmeasured = (p: (typeof paces)[number]) =>
    p.pace.dryHours >= 1
      ? `not measurable: the pool was dry ${Math.round(p.pace.dryHours)} of the last ${Math.min(p.span, Math.round(p.pace.dryHours + p.pace.servedHours))}h`
      : `not measurable yet: ${Math.round(p.pace.servedHours)}h of readings so far`;
  const lead = dry[0] ?? measured[0];

  return (
    <div>
      <h1 className="sr-only">Codex usage</h1>
      <section className="grid grid-cols-[28px_1fr] gap-x-2" aria-label="Verdict">
        <span className={`flex h-6 items-center justify-center ${state === "ok" ? "text-rail" : "text-ink"}`}>
          <HeadGlyph state={state} />
        </span>
        <div className="max-w-[62ch]">
          {!lead ? (
            <>
              <p className="text-base font-medium">Collecting readings. Projections start after 3 hours of them.</p>
              <p className="mt-0.5 text-sm text-ink-2">
                {lanes.map((l) => Number.isFinite(l.resetAt)
                  ? `${label.get(l.id)} is at ${pct(l.used)}, resets ${when(l.resetAt, now)}`
                  : `${label.get(l.id)} is refused by OpenAI`).join(" · ")}.
              </p>
            </>
          ) : (
            <>
              <p className={`text-base ${state === "ok" ? "" : "font-medium"}`}>
                {state === "ok"
                  ? `The pool lasts until every account resets, at the ${measured.map((p) => p.name).join(" and the ")}.`
                  : `At the ${lead.name} the pool ${gapSentence(lead.projection!)}.`}
              </p>
              <p className="mt-0.5 text-sm text-ink-2">
                {paces.map((p) => p === lead && state !== "ok"
                  ? `${p.name[0]!.toUpperCase()}${p.name.slice(1)}: ${pct(p.pace.rate!)}/h of ${base.label}. `
                  : p.projection
                    ? `${p.name[0]!.toUpperCase()}${p.name.slice(1)}: ${pct(p.pace.rate!)}/h, ${p.projection.firstGap === undefined ? "no gap" : `it ${gapSentence(p.projection)}`}. `
                    : `${p.name[0]!.toUpperCase()}${p.name.slice(1)} ${unmeasured(p)}. `).join("")}
                {lanes.map((l) => Number.isFinite(l.resetAt) ? `${label.get(l.id)} at ${pct(l.used)}` : `${label.get(l.id)} refused by OpenAI`).join(", ")}.
              </p>
            </>
          )}
        </div>
      </section>

      {lead && (
        <section className="mt-10" aria-labelledby="coverage-heading">
          <h2 id="coverage-heading" className="text-lg font-semibold tracking-[-0.01em]">
            Coverage until {when(until, now)}
          </h2>
          <p className="mt-0.5 max-w-[60ch] text-sm text-ink-2">
            Who serves reviews each hour if demand holds. Runs take the first account with room, in pool order.
          </p>
          <CoverageStrips now={now} until={until} colorOf={colorOf} resetMarks={resetMarks}
            labelOf={label}
            rows={paces.map((p) => p.projection
              ? { label: `${p.name} · ${pct(p.pace.rate!)}/h`, projection: p.projection }
              : { label: p.name, note: unmeasured(p) })} />
          <Legend items={[
            ...lanes.map((l) => ({ swatch: colorOf.get(l.id)!, label: <>{label.get(l.id)}{speedOf.get(l.id) && <span className="mono"> · {speedOf.get(l.id)}</span>}</> })),
            { swatch: "gap", label: "no capacity" },
          ]} />
          {smaller.length > 0 && (
            <p className="mt-3 max-w-[60ch] text-sm text-ink">
              {smaller.some((a) => !caps.get(a.id)?.measured) ? (
                `The upgrade what-if needs ${smaller.map((a) => a.label).join(", ")}'s capacity measured first: 5 runs and 3% of movement on it.`
              ) : (
                <>
                  With {smaller.map((a) => a.label).join(" and ")} on the <span className="mono">{base.plan}</span> plan
                  from its next reset:{" "}
                  {measured.map((p) => {
                    const after = project(upgraded, p.pace.rate!, now, until);
                    return `${after.firstGap === undefined ? "no gap" : `${hours(after.gapHours)} dry`} at the ${p.name} (now ${p.projection!.firstGap === undefined ? "no gap" : `${hours(p.projection!.gapHours)}`})`;
                  }).join(", ")}.
                </>
              )}
            </p>
          )}
        </section>
      )}

      <section className="mt-12" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold tracking-[-0.01em]">Last week and next week</h2>
        <p className="mt-0.5 max-w-[60ch] text-sm text-ink-2">
          Weekly limit left per account: solid is read from OpenAI, dashed is projected at the 7-day pace.
        </p>
        <HistoryChart report={report} from={historyFrom} now={now} until={Math.max(until, now + DAY)}
          colorOf={colorOf} labelOf={label} past={past.filter((s) => s.to > historyFrom)} projection={atWeek} />
      </section>

      <CostSection report={report} caps={caps} now={now} baseLabel={base.label} />

      <section className="mt-12" aria-labelledby="throughput-heading">
        <h2 id="throughput-heading" className="text-lg font-semibold tracking-[-0.01em]">Throughput</h2>
        <p className="mt-0.5 text-sm text-ink-2">Runs per day, by the account that served them.</p>
        <DailyRuns report={report} now={now} colorOf={colorOf} />
        <Legend items={[
          ...report.accounts.map((a) => ({ swatch: colorOf.get(a.id)!, label: a.label })),
          { swatch: "var(--color-ink-3)", label: "no account: failed before one was assigned, or not recorded" },
        ]} />
        <WeekTable rows={weeks(report, past, now)} />
      </section>

      <p className="mt-12 max-w-[60ch] text-xs text-ink-3">
        Rates are in % of {base.label}'s weekly limit.{" "}
        {report.accounts.slice(1).map((a) => {
          const cap = caps.get(a.id)!;
          return cap.measured
            ? `1% of ${a.label} is worth ${cap.factor.toFixed(2)}% of ${base.label}, measured from tokens per point. `
            : `${a.label} is counted as equal to ${base.label} until it has 5 runs. `;
        })}
        Lines are whole-PR additions plus deletions, counted once per PR.
      </p>
    </div>
  );
}

function CostSection({ report, caps, now, baseLabel }: {
  report: UsageReport;
  caps: ReturnType<typeof capacities>;
  now: number;
  baseLabel: string;
}) {
  const costs = runCosts(report, caps, now);
  const groups = costGroups(costs);
  const biggest = costs.filter((c) => c.run.createdAt >= now - WEEK).sort((a, b) => b.points - a.points).slice(0, 5);
  return (
    <section className="mt-12" aria-labelledby="cost-heading">
      <h2 id="cost-heading" className="text-lg font-semibold tracking-[-0.01em]">Cost per run</h2>
      <p className="mt-0.5 max-w-[60ch] text-sm text-ink-2">
        Median share of {baseLabel}'s weekly limit, by how the run was configured.
      </p>
      {groups.length === 0 ? (
        <p className="mt-4 max-w-[56ch] text-sm text-ink-3">
          No run has reported its speed and quota yet. Runs report them from the action release that
          adds per-run usage.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hair text-left text-ink-2">
                <th className="py-1.5 pr-3 font-normal">Configuration</th>
                <th className="py-1.5 pr-3 text-right font-normal">Runs</th>
                <th className="py-1.5 pr-3 text-right font-normal">Per run</th>
                <th className="py-1.5 pr-3 text-right font-normal">Per 1k lines</th>
                <th className="hidden py-1.5 text-right font-normal sm:table-cell">Per 1M tokens</th>
              </tr>
            </thead>
            <tbody className="mono">
              {groups.map((g) => (
                <tr key={`${g.speed}${g.subagents}`} className="border-b border-hair">
                  <td className="py-1.5 pr-3">{g.speed}{g.subagents ? " · subagents" : ""}</td>
                  <td className="py-1.5 pr-3 text-right">{g.runs}</td>
                  <td className="py-1.5 pr-3 text-right">{pct(g.perRun)}</td>
                  <td className="py-1.5 pr-3 text-right">{g.per1kLines === undefined ? "–" : pct(g.per1kLines)}</td>
                  <td className="hidden py-1.5 text-right sm:table-cell">{g.perMTokens === undefined ? "–" : pct(g.perMTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {biggest.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-medium">Biggest runs this week</h3>
          <ol className="mt-1 divide-y divide-hair border-y border-hair">
            {biggest.map((c) => (
              <li key={c.run.id} className="grid grid-cols-[3.5rem_1fr] gap-x-2 py-2 text-sm">
                <span className="mono text-right text-ink">{pct(c.points)}</span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    {c.run.prNumber !== undefined && <span className="ref shrink-0">#{c.run.prNumber}</span>}
                    <span className="truncate">
                      {c.run.htmlUrl ? <a href={c.run.htmlUrl} className="hover:underline" target="_blank" rel="noreferrer">{c.run.prTitle ?? c.run.kind}</a> : c.run.prTitle ?? c.run.kind}
                    </span>
                  </span>
                  <span className="mono block text-xs text-ink-3">
                    {tokens(c.run.tokens)} tokens{c.run.subagents ? ` · ${c.run.subagents} subagents` : ""}{c.run.speed ? ` · ${c.run.speed}` : ""}{c.estimated ? " · estimated from tokens" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

const dayMonth = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

function WeekTable({ rows }: { rows: ReturnType<typeof weeks> }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Weekly throughput and limit pressure</caption>
        <thead>
          <tr className="border-b border-hair text-ink-2">
            <th className="py-1.5 pr-3 text-left font-normal">Week to</th>
            <th className="py-1.5 pr-3 text-right font-normal">Runs</th>
            <th className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">PRs</th>
            <th className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">Lines</th>
            <th className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">Tokens</th>
            <th className="py-1.5 pr-3 text-right font-normal">No capacity</th>
            <th className="py-1.5 text-right font-normal">Resets used</th>
          </tr>
        </thead>
        <tbody className="mono">
          {rows.map((w, i) => (
            <tr key={w.from} className="border-b border-hair">
              <td className="py-1.5 pr-3">{i === 0 ? "now" : dayMonth.format(w.to)}</td>
              <td className="py-1.5 pr-3 text-right">{w.runs}</td>
              <td className="hidden py-1.5 pr-3 text-right sm:table-cell">{w.prs}</td>
              <td className="hidden py-1.5 pr-3 text-right sm:table-cell">{w.lines ? w.lines.toLocaleString("en") : "–"}</td>
              <td className="hidden py-1.5 pr-3 text-right sm:table-cell">{tokens(w.tokens) || "0"}</td>
              <td className={`py-1.5 pr-3 text-right ${w.noCapacityHours ? "font-medium text-ink" : ""}`}>
                {w.noCapacityHours === undefined ? "–" : hours(w.noCapacityHours)}
              </td>
              <td className="py-1.5 text-right">{w.resetsUsed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

