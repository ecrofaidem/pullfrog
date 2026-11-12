// The Usage page's three charts, drawn as plain SVG at their measured width so
// labels stay at reading size on a phone. Accounts keep their colour across
// every chart (pool order picks it); a stretch with no capacity is always the
// critical hatch plus words, never colour alone.

import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { UsageAccount, UsageReport } from "@server/usageReport";
import { HOUR, resets, usedAt, type AccountId, type Projection, type Segment } from "~/lib/usage";

const SERIES = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)"];

export function seriesColor(index: number): string {
  return SERIES[index] ?? "var(--color-ink-3)";
}

const useIsoLayoutEffect = typeof window === "undefined" ? () => {} : useLayoutEffect;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
const timeLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** local midnights inside (from, to), thinned so labels never touch */
function dayTicks(from: number, to: number, width: number): number[] {
  const ticks: number[] = [];
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  for (let t = d.getTime(); t < to; d.setDate(d.getDate() + 1), t = d.getTime()) ticks.push(t);
  const every = Math.max(1, Math.ceil((ticks.length * 52) / width));
  return ticks.filter((_, i) => i % every === 0);
}

function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="var(--color-critical)" opacity="0.16" />
      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-critical)" strokeWidth="2" />
    </pattern>
  );
}

function fillFor(segment: Segment, colorOf: Map<AccountId, string>, hatch: string): string {
  if (segment.accountId === null) return `url(#${hatch})`;
  if (segment.accountId === undefined) return "var(--color-sheet-2)";
  return colorOf.get(segment.accountId) ?? "var(--color-ink-3)";
}

export function Legend({ items }: { items: { label: ReactNode; swatch: "gap" | string }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            {item.swatch === "gap" ? (
              <>
                <defs><Hatch id={`legend-hatch-${i}`} /></defs>
                <rect width="10" height="10" rx="2" fill={`url(#legend-hatch-${i})`} />
              </>
            ) : (
              <rect width="10" height="10" rx="2" fill={item.swatch} />
            )}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** a pace with its projection, or the reason it could not be measured */
export type StripRow = { label: string; projection: Projection } | { label: string; note: string };

function segmentName(s: Segment, labelOf: Map<AccountId, string>): string {
  return s.accountId === null ? "no capacity" : s.accountId === undefined ? "no readings" : labelOf.get(s.accountId) ?? "account";
}

function span(s: Segment): string {
  return `${timeLabel.format(s.from)} – ${timeLabel.format(s.to)} · ${Math.round((s.to - s.from) / HOUR)}h`;
}

/** who serves reviews each hour from now to the horizon, one bar per pace */
export function CoverageStrips({ rows, now, until, colorOf, labelOf, resetMarks }: {
  rows: StripRow[];
  now: number;
  until: number;
  colorOf: Map<AccountId, string>;
  labelOf: Map<AccountId, string>;
  resetMarks: { at: number; label: string }[];
}) {
  const [ref, width] = useWidth();
  const x = (t: number) => ((t - now) / (until - now)) * width;
  const bar = 24;
  const rowHeight = 20 + bar + 12;
  const top = 18;
  // reset labels that would touch drop to a second line
  const placed: { left: number; right: number; row: number }[] = [];
  const marks = resetMarks.filter((m) => m.at > now && m.at <= until).sort((a, b) => a.at - b.at).map((m) => {
    const mx = Math.min(x(m.at), width - 1);
    const w = m.label.length * 7.5;
    const anchor = mx + w / 2 > width ? "end" as const : "middle" as const;
    const left = anchor === "end" ? mx - w : mx - w / 2;
    const row = placed.some((p) => p.row === 0 && left < p.right + 8 && left + w > p.left - 8) ? 1 : 0;
    placed.push({ left, right: left + w, row });
    return { ...m, mx, anchor, row };
  });
  const height = top + rows.length * rowHeight + 24 + Math.max(0, ...marks.map((m) => m.row)) * 16;
  return (
    <div ref={ref} className="mt-3">
      <svg width={width} height={height} className="block overflow-visible" role="img"
        aria-label={rows.map((row) => "note" in row
          ? `${row.label}: ${row.note}`
          : `${row.label}: ${row.projection.segments.map((s) => `${segmentName(s, labelOf)} until ${timeLabel.format(s.to)}`).join(", ")}`).join(". ")}>
        <defs><Hatch id="strip-hatch" /></defs>
        {dayTicks(now, until, width).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 4} y2={top + rows.length * rowHeight} stroke="var(--color-hair)" />
            <text x={x(t) + 3} y={11} className="fill-ink-3 font-mono text-xs">{dayLabel.format(t)}</text>
          </g>
        ))}
        <text x={0} y={11} className="fill-ink font-mono text-xs">now</text>
        {rows.map((row, r) => {
          const y = top + r * rowHeight;
          return (
            <g key={row.label}>
              <text x={0} y={y + 14} className="fill-ink-2 text-xs" style={{ paintOrder: "stroke", stroke: "var(--color-sheet)", strokeWidth: 4 }}>{row.label}</text>
              {"note" in row ? (
                <g>
                  <rect x={0.5} y={y + 20.5} width={width - 1} height={bar - 1} rx={2} fill="none"
                    stroke="var(--color-ink-3)" strokeDasharray="4 4" />
                  <text x={10} y={y + 20 + bar / 2 + 4} className="fill-ink-2 text-xs">{row.note}</text>
                </g>
              ) : row.projection.segments.map((s) => {
                const w = Math.max(0, x(s.to) - x(s.from) - (s.to < until ? 2 : 0));
                const hours = Math.round((s.to - s.from) / HOUR);
                // the hatch always carries words: in full when it fits, the hours when it does not
                const words = s.accountId !== null ? null : w > 112 ? `no capacity · ${hours}h` : w > 28 ? `${hours}h` : null;
                return (
                  <g key={s.from}>
                    <rect x={x(s.from)} y={y + 20} width={w} height={bar} rx={2} fill={fillFor(s, colorOf, "strip-hatch")}>
                      <title>{`${segmentName(s, labelOf)} · ${span(s)}`}</title>
                    </rect>
                    {words && (
                      <text x={x(s.from) + w / 2} y={y + 20 + bar / 2 + 4} textAnchor="middle"
                        className="fill-ink font-mono text-xs font-medium" style={{ paintOrder: "stroke", stroke: "var(--color-sheet)", strokeWidth: 3 }}>
                        {words}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        {marks.map(({ mx, anchor, ...m }) => {
          const base = top + rows.length * rowHeight + 10;
          return (
            <g key={m.at}>
              <line x1={mx} x2={mx} y1={top + 14} y2={base + m.row * 16 - 2} stroke="var(--color-ink)" strokeWidth="1.5" />
              <text x={mx} y={base + 10 + m.row * 16} textAnchor={anchor} className="fill-ink-2 font-mono text-xs">{m.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const LANE = 72;

function pointerX(e: PointerEvent<SVGSVGElement>): number {
  const box = e.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(box.width, e.clientX - box.left));
}

/** 1, 2, 2.5 or 5 × 10ⁿ at or above `raw` */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * pow;
}

/** last week measured, next week projected: % left per account, the capacity band, and run density */
export function HistoryChart({ report, from, now, until, colorOf, labelOf, past, projection }: {
  report: UsageReport;
  from: number;
  now: number;
  until: number;
  colorOf: Map<AccountId, string>;
  labelOf: Map<AccountId, string>;
  past: Segment[];
  projection: Projection | null;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const accounts = report.accounts.filter((a) => a.enabled);
  const x = (t: number) => ((t - from) / (until - from)) * width;
  const laneTop = (i: number) => 22 + i * (LANE + 26);
  const bandTop = laneTop(accounts.length) - 4;
  const runsTop = bandTop + 30;
  const height = runsTop + 54;
  const y = (i: number, used: number) => laneTop(i) + 18 + (used / 100) * (LANE - 18);

  const buckets = new Map<number, number>();
  for (const r of report.runs) {
    if (r.createdAt < from) continue;
    const b = Math.floor(r.createdAt / (3 * HOUR));
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const most = Math.max(1, ...buckets.values());
  const bw = Math.max(1, x(from + 3 * HOUR) - x(from) - 1);

  function measuredPath(account: UsageAccount, i: number): string {
    const points: [number, number][] = [];
    const start = usedAt(account.samples, from);
    if (start !== undefined) points.push([from, start]);
    for (const s of account.samples) if (s.at >= from) points.push([s.at, s.usedPercent]);
    const end = usedAt(account.samples, now);
    if (end !== undefined) points.push([now, end]);
    return points.map(([t, used], k) => `${k ? "L" : "M"}${x(t)},${y(i, used)}`).join("");
  }

  const bands = [...past, ...(projection?.segments ?? [])];
  const tip = hover === null ? null : (() => {
    const at = from + (hover / width) * (until - from);
    const future = at > now;
    const band = bands.find((s) => s.from <= at && at < s.to);
    return {
      at, future, served: band ? segmentName(band, labelOf) : undefined,
      rows: accounts.map((a) => {
        const path = projection?.paths.get(a.id);
        const used = future ? [...(path ?? [])].reverse().find((p) => p.at <= at)?.used : usedAt(a.samples, at);
        return { a, used };
      }),
    };
  })();

  return (
    <div ref={ref} className="relative mt-3">
      <svg width={width} height={height} className="block overflow-visible" role="img" tabIndex={0}
        style={{ touchAction: "pan-y" }}
        aria-label={accounts.map((a) => {
          const left = 100 - (usedAt(a.samples, now) ?? 0);
          const out = projection?.runsOut.get(a.id);
          return `${a.label}: ${Math.round(left)}% left now${out ? `, projected out ${timeLabel.format(out)}` : ""}`;
        }).join(". ")}
        onPointerDown={(e) => setHover(pointerX(e))}
        onPointerMove={(e) => { if (e.pointerType === "mouse" || e.buttons) setHover(pointerX(e)); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          const stepPx = (3 * HOUR / (until - from)) * width;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setHover((h) => Math.max(0, Math.min(width, (h ?? x(now)) + (e.key === "ArrowRight" ? stepPx : -stepPx))));
          } else if (e.key === "Escape") setHover(null);
        }}>
        <defs><Hatch id="band-hatch" /></defs>
        {dayTicks(from, until, width).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={14} y2={runsTop + 36} stroke="var(--color-hair)" strokeOpacity="0.6" />
            <text x={x(t) + 3} y={height - 2} className="fill-ink-3 font-mono text-xs">{dayLabel.format(t)}</text>
          </g>
        ))}
        {accounts.map((a, i) => {
          const color = colorOf.get(a.id)!;
          const proj = projection?.paths.get(a.id);
          return (
            <g key={a.id}>
              <text x={0} y={laneTop(i) + 10} className="fill-ink text-sm font-medium">{a.label}</text>
              {i === 0 && (
                <>
                  <text x={width} y={y(i, 0) - 4} textAnchor="end" className="fill-ink-3 font-mono text-xs">full</text>
                  <text x={width} y={y(i, 100) - 4} textAnchor="end" className="fill-ink-3 font-mono text-xs">out</text>
                </>
              )}
              <line x1={0} x2={width} y1={y(i, 100)} y2={y(i, 100)} stroke="var(--color-hair)" />
              <line x1={0} x2={width} y1={y(i, 0)} y2={y(i, 0)} stroke="var(--color-hair)" strokeDasharray="2 3" />
              <path d={measuredPath(a, i)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
              {resets(report).filter((r) => r.early && r.accountId === a.id && r.at >= from).map((r) => (
                <text key={r.at} x={x(r.at) - 4} y={y(i, 0) - 4} textAnchor="end" className="fill-ink-2 font-mono text-xs"
                  style={{ paintOrder: "stroke", stroke: "var(--color-sheet)", strokeWidth: 3 }}>reset used</text>
              ))}
              {proj && (
                <path d={proj.map((p, k) => `${k ? "L" : "M"}${x(p.at)},${y(i, p.used)}`).join("")}
                  fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="5 4" />
              )}
            </g>
          );
        })}
        <text x={0} y={bandTop - 4} className="fill-ink-2 text-xs">served by</text>
        {[...past, ...(projection?.segments ?? [])].map((s) => (
          <rect key={`${s.from}-${s.accountId}`} x={x(Math.max(s.from, from))} y={bandTop} width={Math.max(0, x(s.to) - x(Math.max(s.from, from)))} height={14}
            fill={fillFor(s, colorOf, "band-hatch")} opacity={s.from >= now && s.accountId ? 0.5 : 1} />
        ))}
        {[...buckets.entries()].map(([b, n]) => {
          const h = (n / most) * 22;
          return <rect key={b} x={x(b * 3 * HOUR)} y={runsTop + 34 - h} width={bw} height={h} fill="var(--color-ink-3)" />;
        })}
        <text x={0} y={runsTop + 4} className="fill-ink-2 text-xs">runs per 3h · busiest {most}</text>
        <line x1={x(now)} x2={x(now)} y1={14} y2={runsTop + 36} stroke="var(--color-ink)" strokeWidth="1.5" />
        <text x={x(now) + 4} y={22} className="fill-ink font-mono text-xs">now</text>
        {hover !== null && <line x1={hover} x2={hover} y1={14} y2={runsTop + 36} stroke="var(--color-ink-3)" />}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-sm border border-hair bg-sheet px-2 py-1 text-xs"
          style={{ left: Math.min(Math.max(0, hover! + 8), width - 180) }}>
          <p className="mono text-ink">{timeLabel.format(tip.at)}{tip.future ? " · projected" : ""}</p>
          {tip.served && <p className={tip.served === "no capacity" ? "font-medium text-ink" : "text-ink-2"}>served by {tip.served}</p>}
          {tip.rows.map(({ a, used }) => (
            <p key={a.id} className="text-ink-2">
              <span className="mr-1 inline-block size-2 rounded-xs" style={{ background: colorOf.get(a.id) }} />
              {a.label} <span className="mono text-ink">{used === undefined ? "–" : `${Math.round(100 - used)}% left`}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** reviews per day for two weeks, stacked by the account that served them */
export function DailyRuns({ report, now, colorOf }: { report: UsageReport; now: number; colorOf: Map<AccountId, string> }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 13);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const from = d.getTime();
    d.setDate(d.getDate() + 1);
    const runs = report.runs.filter((r) => r.createdAt >= from && r.createdAt < d.getTime());
    const parts = [...report.accounts.map((a) => ({ id: a.id as AccountId | undefined, label: a.label, n: 0 })),
      { id: undefined, label: "no account", n: 0 }];
    for (const r of runs) (parts.find((p) => p.id === r.accountId) ?? parts.at(-1)!).n += 1;
    return { from, total: runs.length, parts: parts.filter((p) => p.n > 0) };
  });
  const max = Math.max(4, ...days.map((d) => d.total));
  const step = Math.max(1, niceStep(max / 4));
  const ticks = Math.ceil(max / step);
  const top = step * ticks;
  const plotH = 120;
  const left = 28;
  const slot = (width - left) / 14;
  const yv = (v: number) => 8 + plotH - (v / top) * plotH;
  return (
    <div ref={ref} className="relative mt-3">
      <svg width={width} height={plotH + 34} className="block" role="img" tabIndex={0} style={{ touchAction: "pan-y" }}
        aria-label={`Runs per day, last 14 days: ${days.map((d) => `${dayLabel.format(d.from)} ${d.total}`).join(", ")}`}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setHover((h) => Math.max(0, Math.min(13, (h ?? 14) + (e.key === "ArrowRight" ? 1 : -1))));
          } else if (e.key === "Escape") setHover(null);
        }}>
        {Array.from({ length: ticks + 1 }, (_, k) => (
          <g key={k}>
            <line x1={left} x2={width} y1={yv(k * step)} y2={yv(k * step)} stroke="var(--color-hair)" strokeOpacity={k ? 0.6 : 1} />
            <text x={left - 6} y={yv(k * step) + 4} textAnchor="end" className="fill-ink-3 font-mono text-xs">{k * step}</text>
          </g>
        ))}
        {days.map((d, i) => {
          let acc = 0;
          const bx = left + i * slot + slot * 0.18;
          const bwid = slot * 0.64;
          return (
            <g key={d.from} onPointerDown={() => setHover(i)} onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(i); }}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}>
              <rect x={left + i * slot} y={0} width={slot} height={plotH + 8} fill="transparent" />
              {d.parts.map((p) => {
                const y0 = yv(acc);
                acc += p.n;
                const y1 = yv(acc);
                return <rect key={p.label} x={bx} y={y1} width={bwid} height={Math.max(0, y0 - y1 - 2)} rx={1}
                  fill={p.id ? colorOf.get(p.id) : "var(--color-ink-3)"} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })}
              {(i % (slot < 30 ? 2 : 1) === 0 || i === 13) && (
                <text x={bx + bwid / 2} y={plotH + 28} textAnchor="middle" className="fill-ink-3 font-mono text-xs">
                  {new Date(d.from).getDate()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-sm border border-hair bg-sheet px-2 py-1 text-xs"
          style={{ left: Math.min(left + hover * slot + slot, width - 170) }}>
          <p className="mono text-ink">{dayLabel.format(days[hover]!.from)} · {days[hover]!.total} runs</p>
          {days[hover]!.parts.map((p) => (
            <p key={p.label} className="text-ink-2">{p.label} <span className="mono text-ink">{p.n}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}
