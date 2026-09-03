// Runs: the rail. HEAD carries the health sentence; every run below is a node.

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Doc } from "@server/_generated/dataModel";
import { ArrowOut, HeadGlyph, type RowState, STATE_LABEL, StateGlyph } from "~/components/glyphs";
import { RailSkeleton } from "~/components/skeleton";
import { duration, relative, stamp, tokens, usd } from "~/lib/format";
import { deriveHealth, type Health, reseedCommand } from "~/lib/health";
import { useNow } from "~/lib/now";
import { fullName, healthQuery, pickRepo, reposQuery, RUNS_LIMIT, runsQuery, useCurrentRepo } from "~/lib/repo";

export const Route = createFileRoute("/_app/")({
  loaderDeps: ({ search }) => ({ repo: search.repo }),
  loader: async ({ context, deps }) => {
    const repos = await context.queryClient.ensureQueryData(reposQuery);
    const repo = pickRepo(repos, deps.repo);
    if (!repo) return;
    await Promise.all([
      context.queryClient.ensureQueryData(runsQuery(repo)),
      context.queryClient.ensureQueryData(healthQuery(repo)),
    ]);
  },
  pendingComponent: RailSkeleton,
  component: RunsPage,
});

/** an open run this old is not going to report back; the sweep marks it failed later */
const STALL_MS = 30 * 60 * 1000;

function RunsPage() {
  const repo = useCurrentRepo()!;
  const { data: runs } = useSuspenseQuery(runsQuery(repo));
  const { data: healthData } = useSuspenseQuery(healthQuery(repo));
  const hasOpen = runs.some((r) => isOpen(r.status));
  const now = useNow(hasOpen ? 1000 : 30_000);
  const health = deriveHealth(healthData, now);

  return (
    <section aria-labelledby="runs-heading">
      <h1 id="runs-heading" className="sr-only">
        Runs for {fullName(repo)}
      </h1>
      <Rail key={fullName(repo)} runs={runs} health={health} handle={repo.handle} now={now} />
    </section>
  );
}

function isOpen(status: Doc<"runs">["status"]): boolean {
  return status === "in_progress" || status === "queued" || status === "dispatched";
}

// ── the rail ─────────────────────────────────────────────────────────────────

const GLYPH_COL = 28; // px: glyph column width; the rail line sits at its centre
const LANE_OFFSET = 12; // px: the incremental-review lane runs this far right of the rail
const ARRIVAL_MS = 900; // how long a row keeps its arrival motion

interface Lane {
  fromY: number;
  toY: number;
}

function Rail({
  runs,
  health,
  handle,
  now,
}: {
  runs: Doc<"runs">[];
  health: Health;
  handle: string;
  now: number | null;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);

  // arrivals: ids first seen after mount get the row-in motion and pull the
  // rail down from HEAD to them; everything present at mount is just there.
  const seen = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<{ ids: Set<string>; key: number }>({ ids: new Set(), key: 0 });
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(runs.map((r) => r._id));
      return;
    }
    const fresh = runs.filter((r) => !seen.current!.has(r._id)).map((r) => r._id);
    if (fresh.length === 0) return;
    for (const id of fresh) seen.current.add(id);
    setArrived((a) => ({ ids: new Set([...a.ids, ...fresh]), key: a.key + 1 }));
    const timer = setTimeout(
      () =>
        setArrived((a) => {
          const ids = new Set(a.ids);
          for (const id of fresh) ids.delete(id);
          return { ids, key: a.key };
        }),
      ARRIVAL_MS
    );
    return () => clearTimeout(timer);
  }, [runs]);

  // an incremental review draws a lane back to the review it extends: the
  // nearest older run on the same PR. measured from the glyphs themselves so
  // the curve lands on the node centres whatever the row heights are.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const glyphs = Array.from(list.querySelectorAll<HTMLElement>("[data-node] > [data-glyph]"));
      const top = list.getBoundingClientRect().top;
      const centre = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.top - top + r.height / 2;
      };
      const next: Lane[] = [];
      runs.forEach((run, i) => {
        if (run.kind !== "incremental_review" || run.prNumber === undefined) return;
        const parentIndex = runs.findIndex((r, j) => j > i && r.prNumber === run.prNumber);
        if (parentIndex === -1) return;
        const from = glyphs[i];
        const to = glyphs[parentIndex];
        if (from && to) next.push({ fromY: centre(from), toY: centre(to) });
      });
      setLanes((prev) =>
        prev.length === next.length && prev.every((l, i) => l.fromY === next[i]!.fromY && l.toY === next[i]!.toY)
          ? prev
          : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const li of list.children) observer.observe(li);
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener("load", measure);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("load", measure);
    };
  }, [runs]);

  const x = GLYPH_COL / 2;
  const broken = health.kind === "cut" || health.kind === "missing";
  const railStyle = {
    left: x,
    background: broken
      ? `repeating-linear-gradient(to bottom, var(--color-ink-3) 0 4px, transparent 4px 8px)`
      : "var(--color-rail)",
  } as const;

  return (
    <div className="relative">
      {/* the rail: one hairline from HEAD through every node, dashed when HEAD is cut */}
      <div aria-hidden className="absolute bottom-3 top-3 w-px" style={railStyle} />
      {/* a new run arrived: a heavier stroke draws down from HEAD and fades */}
      {arrived.key > 0 && (
        <div
          key={arrived.key}
          aria-hidden
          className="rail-draw absolute bottom-3 top-3 w-[3px]"
          style={{ left: x - 1, background: "var(--color-rail)" }}
        />
      )}
      <Head health={health} />
      <div className="relative mt-2">
        {lanes.length > 0 && (
          <svg
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-20 h-full w-16 text-rail"
            fill="none"
          >
            {lanes.map((l, i) => (
              <path
                key={i}
                d={`M ${x + 5} ${l.fromY} C ${x + LANE_OFFSET} ${l.fromY}, ${x + LANE_OFFSET} ${l.fromY + 6}, ${x + LANE_OFFSET} ${l.fromY + 10} L ${x + LANE_OFFSET} ${l.toY - 10} C ${x + LANE_OFFSET} ${l.toY - 6}, ${x + LANE_OFFSET} ${l.toY}, ${x + 5} ${l.toY}`}
                stroke="currentColor"
                strokeWidth="1"
                strokeOpacity="0.7"
              />
            ))}
          </svg>
        )}
        {runs.length === 0 ? (
          <EmptyRail handle={handle} />
        ) : (
          <ol ref={listRef} className="relative" aria-live="polite" aria-relevant="additions">
            {runs.map((run, i) => (
              <RunRow
                key={run._id}
                run={run}
                now={now}
                arrived={arrived.ids.has(run._id)}
                // the PR title leads its group; later runs of the same PR show what they are
                leadsGroup={i === 0 || runs[i - 1]!.prNumber !== run.prNumber}
              />
            ))}
          </ol>
        )}
      </div>
      {runs.length >= RUNS_LIMIT && (
        <p className="mt-6 pl-7 text-sm text-ink-3">Showing the newest {RUNS_LIMIT} runs.</p>
      )}
    </div>
  );
}

function Head({ health }: { health: Health }) {
  const ok = health.kind === "ok";
  return (
    <div className="grid grid-cols-[28px_1fr] items-start gap-x-2">
      <span
        className={`relative z-10 flex h-6 items-center justify-center bg-sheet ${ok ? "text-rail" : "text-ink"}`}
      >
        <HeadGlyph state={health.kind} />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-base leading-6">
          <span className="mono text-sm text-ink-2">HEAD</span>
          <span className={ok ? "text-ink-2" : "font-medium text-ink"}>{health.line}</span>
        </p>
        {health.detail && <p className="mt-1 max-w-[60ch] text-sm text-ink-2">{health.detail}</p>}
        {health.kind === "warn" && health.failedUrl && (
          <p className="mt-1 text-sm">
            <a href={health.failedUrl} className="inline-flex items-center gap-1 text-ink-2 hover:text-ink" target="_blank" rel="noreferrer">
              Open the newest failed run's log <ArrowOut />
            </a>
          </p>
        )}
        {(health.kind === "cut" || health.kind === "missing") && (
          <div className="mt-2 text-sm">
            <p className="text-ink-2">To sign in again, run this from a checkout of the repo:</p>
            <pre className="command mt-1" tabIndex={0}>
              <code className="select-all">{reseedCommand()}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({
  run,
  now,
  arrived,
  leadsGroup,
}: {
  run: Doc<"runs">;
  now: number | null;
  arrived: boolean;
  leadsGroup: boolean;
}) {
  const open = isOpen(run.status);
  const stalled = open && now !== null && now - run.createdAt > STALL_MS;
  const state: RowState = stalled ? "stalled" : run.status;
  const active = run.status === "in_progress" && !stalled;
  const settledAt = run.completedAt ?? run.updatedAt;
  const elapsed = open
    ? stalled
      ? duration(run.createdAt, run.createdAt + STALL_MS)
      : now === null
        ? ""
        : duration(run.createdAt, now)
    : duration(run.createdAt, settledAt);
  const prHref =
    run.prNumber !== undefined
      ? `https://github.com/${run.owner}/${run.repo}/pull/${run.prNumber}`
      : undefined;
  const showPrTitle = leadsGroup && run.prTitle !== undefined;
  const title = showPrTitle ? run.prTitle : kindLabel(run);
  const refLabel = run.prNumber !== undefined ? `#${run.prNumber}` : undefined;
  const failure = run.error ? describeError(run.error) : undefined;

  return (
    <li
      className={`grid grid-cols-[28px_1fr] items-start gap-x-2 py-3 ${arrived ? "row-in" : ""}`}
      data-node
    >
      <span
        className="relative z-10 flex h-6 items-center justify-center bg-sheet text-ink"
        data-glyph
      >
        <StateGlyph state={state} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {refLabel && (
            <a
              href={prHref}
              className="ref no-underline hover:border-ink-3"
              target="_blank"
              rel="noreferrer"
              aria-label={`Pull request ${refLabel} on GitHub`}
            >
              {refLabel}
            </a>
          )}
          {prHref && showPrTitle ? (
            <a
              href={prHref}
              className="text-base leading-6 text-ink no-underline hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {title}
            </a>
          ) : (
            <span className="text-base leading-6 text-ink">{title}</span>
          )}
          <span className={`text-sm ${active ? "text-rail" : "text-ink-2"}`}>
            {STATE_LABEL[state]}
            {run.conclusion && run.status === "failed" && run.conclusion !== "failure"
              ? ` (${run.conclusion})`
              : ""}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-ink-2">
          {showPrTitle && <span>{kindLabel(run)}</span>}
          {run.triggerer && <span className="mono">{run.triggerer}</span>}
          <time
            className="mono"
            dateTime={new Date(run.createdAt).toISOString()}
            title={`${stamp(run.createdAt)} UTC`}
          >
            {relative(run.createdAt, now)}
          </time>
          {elapsed && <span className="mono text-ink-3">{elapsed}</span>}
          {run.model && <span className="mono text-ink-3">{run.model.replace(/^openai\//, "")}</span>}
          {run.credential === "subscription" && <span className="text-ink-3">subscription</span>}
          {(run.inputTokens !== undefined || run.outputTokens !== undefined) && (
            <span className="mono text-ink-3">
              {tokens(run.inputTokens)} in · {tokens(run.outputTokens)} out
              {run.costUsd !== undefined && ` · ${usd(run.costUsd)}`}
            </span>
          )}
          {run.htmlUrl && (
            <a
              href={run.htmlUrl}
              className="tab inline-flex items-center gap-1 text-ink-2 no-underline hover:text-ink"
              target="_blank"
              rel="noreferrer"
              aria-label={`Actions log for ${refLabel ?? kindLabel(run)}`}
            >
              Actions log <ArrowOut />
            </a>
          )}
        </div>
        {failure && (
          <div className="mt-1 max-w-[60ch] text-sm text-ink-2">
            <p>{failure.summary}</p>
            {failure.raw && (
              <details className="mt-0.5">
                <summary className="cursor-pointer text-ink-3">raw error</summary>
                <pre className="command mt-1 text-xs">{failure.raw}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function kindLabel(run: Doc<"runs">): string {
  switch (run.kind) {
    case "review":
      return run.trigger === "issue_comment_created" ? "review, requested by comment" : "review";
    case "incremental_review":
      return "incremental review";
    case "manual":
      return "workflow run";
    default:
      return run.kind.replace(/_/g, " ");
  }
}

/** a plain sentence for the error the server recorded, with the raw text on request. */
function describeError(raw: string): { summary: string; raw: string | undefined } {
  const github = /^GitHub (\d{3}) on ([^:]+):/.exec(raw);
  if (github) {
    const [, status, path] = github;
    const what = path!.includes("/dispatches")
      ? "starting the workflow"
      : path!.includes("/check-runs")
        ? "creating the status check"
        : `calling ${path}`;
    const why =
      status === "404"
        ? "The workflow file may be missing from the default branch, or the App is not installed on this repo."
        : status === "403"
          ? "The App does not have a permission it needs."
          : "";
    return { summary: `GitHub returned ${status} while ${what}. ${why}`.trim(), raw };
  }
  if (raw.startsWith("No completion reported")) return { summary: raw, raw: undefined };
  return { summary: raw.length > 160 ? `${raw.slice(0, 160)}…` : raw, raw: raw.length > 160 ? raw : undefined };
}

function EmptyRail({ handle }: { handle: string }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-x-2 py-3">
      <span className="relative z-10 flex h-6 items-center justify-center bg-sheet text-ink-3">
        <StateGlyph state="queued" />
      </span>
      <div className="max-w-[56ch] text-base text-ink-2">
        <p>No runs yet. The first one appears here as soon as GitHub sends the event.</p>
        <p className="mt-2 text-sm text-ink-3">
          Open a pull request as an allowed author, or comment{" "}
          <code className="text-ink-2">@{handle} review</code> on any PR.
        </p>
      </div>
    </div>
  );
}
