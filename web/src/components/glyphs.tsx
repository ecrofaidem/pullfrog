// The state glyphs and the few icons the page needs, all authored SVG in one
// stroke weight. State is shape plus a text label, never a hue: only the
// in-progress ring wears the rail colour.

import type { Doc } from "@server/_generated/dataModel";

export type RunState = Doc<"runs">["status"];
/** a run still open long after its timeout: the server will sweep it, the page names it first */
export type RowState = RunState | "stalled";

const STROKE = 1.5;

export function StateGlyph({ state, className = "" }: { state: RowState; className?: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true,
    className,
  } as const;
  switch (state) {
    case "completed":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4.5" fill="currentColor" />
        </svg>
      );
    case "in_progress":
      return (
        <svg {...common} className={`${className} glyph-active text-rail`}>
          <circle
            cx="8"
            cy="8"
            r="4.5"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeDasharray="20 8.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth={STROKE} />
          <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" stroke="currentColor" strokeWidth={STROKE} />
        </svg>
      );
    case "cancelled":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth={STROKE} />
          <path d="M4.8 11.2l6.4-6.4" stroke="currentColor" strokeWidth={STROKE} />
        </svg>
      );
    case "stalled":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth={STROKE} strokeDasharray="2.5 2.2" />
        </svg>
      );
    case "queued":
    case "dispatched":
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth={STROKE} />
        </svg>
      );
  }
}

export const STATE_LABEL: Record<RowState, string> = {
  dispatched: "dispatched",
  queued: "queued",
  in_progress: "in progress",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
  stalled: "no result yet",
};

export type HeadState = "ok" | "warn" | "cut" | "missing";

/** HEAD marker: ok has a core, warn is the ring with no core, cut is a dashed
 * ring struck through, missing is a dashed ring with nothing inside. */
export function HeadGlyph({ state }: { state: HeadState }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      {state === "cut" && (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth={STROKE} strokeDasharray="3 2.5" />
          <path d="M3 13L13 3" stroke="currentColor" strokeWidth={STROKE} />
        </>
      )}
      {state === "missing" && (
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth={STROKE} strokeDasharray="3 2.5" />
      )}
      {(state === "ok" || state === "warn") && (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth={STROKE} />
          {state === "ok" && <circle cx="8" cy="8" r="2" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}

export function ArrowOut({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className={className}>
      <path d="M4 2.5h5.5V8M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className={className}>
      <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className={className}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth={STROKE} />
      <path d="M2.5 8V2.5H8" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  );
}

/** a plain list mark for things that are not runs */
export function Dot({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export function GitHubMark({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.35c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.65-.89-3.65-3.96 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.08-1.87 3.75-3.66 3.95.29.25.55.74.55 1.48v2.2c0 .21.14.46.55.38A8 8 0 0 0 8 .2z" />
    </svg>
  );
}
