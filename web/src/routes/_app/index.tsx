// Runs: the rail. HEAD carries the health sentence; every run below is a node.

import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { api } from "@server/_generated/api";
import type { Doc } from "@server/_generated/dataModel";
import { ArrowOut, HeadGlyph, STATE_LABEL, StateGlyph } from "~/components/glyphs";
import { ago, duration, tokens, usd } from "~/lib/format";
import { deriveHealth, type Health } from "~/lib/health";
import { useCurrentRepo } from "~/lib/repo";

export const Route = createFileRoute("/_app/")({
  component: RunsPage,
});

const LIMIT = 100;

function RunsPage() {
  const repo = useCurrentRepo()!;
  const args = { owner: repo.owner, repo: repo.name };
  const { data: runs } = useSuspenseQuery(convexQuery(api.runs.list, { ...args, limit: LIMIT }));
  const { data: secrets } = useSuspenseQuery(convexQuery(api.secrets.status, args));
  const health = deriveHealth(secrets, runs);

  return (
    <section aria-label="Runs">
      <Rail runs={runs} health={health} handle={repo.handle} />
    </section>
  );
}

// ── the rail ─────────────────────────────────────────────────────────────────

const GLYPH_COL = 28; // px: glyph column width; the rail line sits at its centre
const LANE_OFFSET = 10; // px: the incremental-review lane runs this far right of the rail

interface Lane {
  fromY: number;
  toY: number;
}

function Rail({ runs, health, handle }: { runs: Doc<"runs">[]; health: Health; handle: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);

  // an incremental review draws a lane back to the review it extends: the
  // nearest older run on the same PR. measured from the DOM so the curve lands
  // on the real node centres whatever the row heights are.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nodes = Array.from(list.querySelectorAll<HTMLElement>("[data-node]"));
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
      const from = nodes[i];
      const to = nodes[parentIndex];
      if (from && to) next.push({ fromY: centre(from), toY: centre(to) });
    });
    setLanes(next);
  }, [runs]);

  const x = GLYPH_COL / 2;

  return (
    <div className="relative">
      {/* the rail: one hairline from HEAD through every node, dashed when HEAD is cut */}
      <div
        aria-hidden
        className="absolute bottom-3 top-3 w-px"
        style={{
          left: x,
          background:
            health.kind === "cut"
              ? `repeating-linear-gradient(to bottom, var(--color-hair) 0 4px, transparent 4px 8px)`
              : "var(--color-hair)",
        }}
      />
      <Head health={health} />
      <div className="relative mt-2">
        {/* incremental-review lanes */}
        {lanes.length > 0 && (
          <svg
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-full w-16 text-hair"
            fill="none"
          >
            {lanes.map((l, i) => (
              <path
                key={i}
                d={`M ${x} ${l.fromY} C ${x + LANE_OFFSET} ${l.fromY}, ${x + LANE_OFFSET} ${l.fromY + 8}, ${x + LANE_OFFSET} ${l.fromY + 12} L ${x + LANE_OFFSET} ${l.toY - 12} C ${x + LANE_OFFSET} ${l.toY - 8}, ${x + LANE_OFFSET} ${l.toY}, ${x} ${l.toY}`}
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
          </svg>
        )}
        {runs.length === 0 ? (
          <EmptyRail handle={handle} />
        ) : (
          <ol ref={listRef} className="relative">
            {runs.map((run) => (
              <RunRow key={run._id} run={run} />
            ))}
          </ol>
        )}
      </div>
      {runs.length >= LIMIT && (
        <p className="mt-6 pl-7 text-sm text-ink-3">Showing the newest {LIMIT} runs.</p>
      )}
    </div>
  );
}

function Head({ health }: { health: Health }) {
  const cut = health.kind === "cut";
  return (
    <div className="grid grid-cols-[28px_1fr] items-start gap-x-2">
      <span className={`relative z-10 flex h-6 items-center justify-center bg-sheet ${cut ? "text-ink" : "text-rail"}`}>
        <HeadGlyph cut={cut} />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-base leading-6">
          <span className="mono text-sm text-ink-2">HEAD</span>
          <span className={cut ? "font-medium text-ink" : "text-ink-2"}>{health.line}</span>
        </p>
        {health.kind !== "ok" && (
          <p className="mt-1 max-w-[60ch] text-sm text-ink-2">{health.detail}</p>
        )}
        {health.kind === "cut" && (
          <div className="mt-2 text-sm">
            <p className="text-ink-2">Reseed from a checkout of the repo:</p>
            <pre className="mt-1 overflow-x-auto rounded-sm bg-sheet-2 px-3 py-2 text-xs text-ink">
              <code className="select-all">{health.command}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: Doc<"runs"> }) {
  const active = run.status === "in_progress";
  const settledAt = run.completedAt ?? run.updatedAt;
  const elapsed =
    run.status === "in_progress" || run.status === "queued" || run.status === "dispatched"
      ? duration(run.createdAt, Date.now())
      : duration(run.createdAt, settledAt);
  const prHref = run.prNumber !== undefined ? `https://github.com/${run.owner}/${run.repo}/pull/${run.prNumber}` : undefined;

  return (
    <li className="row-in grid grid-cols-[28px_1fr] items-start gap-x-2 py-3" data-node>
      <span className="relative z-10 flex h-6 items-center justify-center bg-sheet text-ink">
        <StateGlyph state={run.status} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {run.prNumber !== undefined && (
            <a href={prHref} className="ref no-underline hover:border-ink-3" target="_blank" rel="noreferrer">
              #{run.prNumber}
            </a>
          )}
          <span className={`text-base leading-6 ${active ? "text-ink" : "text-ink"}`}>
            {kindLabel(run)}
          </span>
          <span className={`text-sm ${active ? "text-rail" : "text-ink-2"}`}>
            {STATE_LABEL[run.status]}
            {run.conclusion && run.status === "failed" && run.conclusion !== "failure"
              ? ` (${run.conclusion})`
              : ""}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-ink-2">
          {run.triggerer && <span className="mono">{run.triggerer}</span>}
          <time dateTime={new Date(run.createdAt).toISOString()} title={new Date(run.createdAt).toLocaleString()}>
            {ago(run.createdAt)}
          </time>
          <span className="mono text-ink-3">{elapsed}</span>
          {run.model && <span className="mono text-ink-3">{run.model.replace(/^openai\//, "")}</span>}
          {run.credential === "subscription" && <span className="text-ink-3">subscription</span>}
          {(run.inputTokens !== undefined || run.outputTokens !== undefined) && (
            <span className="mono text-ink-3">
              {tokens(run.inputTokens)} in · {tokens(run.outputTokens)} out
              {run.costUsd !== undefined && ` · ${usd(run.costUsd)}`}
            </span>
          )}
          {run.htmlUrl && (
            <a href={run.htmlUrl} className="inline-flex items-center gap-1 text-ink-2 hover:text-ink" target="_blank" rel="noreferrer">
              Actions log <ArrowOut />
            </a>
          )}
        </div>
        {run.error && <p className="mt-1 max-w-[60ch] text-sm text-ink">{run.error}</p>}
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
      return run.title || "manual run";
    default:
      return run.kind;
  }
}

function EmptyRail({ handle }: { handle: string }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-x-2 py-3">
      <span className="relative z-10 flex h-6 items-center justify-center bg-sheet text-ink-3">
        <StateGlyph state="queued" />
      </span>
      <div className="max-w-[56ch] text-base text-ink-2">
        <p>No runs yet. The first one appears here the moment a webhook dispatches it.</p>
        <p className="mt-2 text-sm text-ink-3">
          Open a pull request as an allowlisted author, or comment{" "}
          <code className="text-ink-2">@{handle} review</code> on any PR.
        </p>
      </div>
    </div>
  );
}

