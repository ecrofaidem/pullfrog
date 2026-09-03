// The one-line health banner every non-Runs view carries under the header:
// the same HEAD sentence the rail starts from, from the same subscription.

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Doc } from "@server/_generated/dataModel";
import { HeadGlyph } from "~/components/glyphs";
import { deriveHealth } from "~/lib/health";
import { useNow } from "~/lib/now";
import { healthQuery } from "~/lib/repo";

export function HealthLine({ repo }: { repo: Doc<"repos"> }) {
  const { data } = useSuspenseQuery(healthQuery(repo));
  const now = useNow();
  const health = deriveHealth(data, now);
  const ok = health.kind === "ok";

  return (
    <Link
      to="/"
      search={(prev) => prev}
      className="-mx-1 mt-3 grid grid-cols-[28px_1fr] items-start gap-x-2 rounded-sm px-1 py-1 no-underline hover:bg-sheet-2"
      aria-label={`Health: ${health.line}. Open runs.`}
    >
      <span className={`flex h-6 items-center justify-center ${ok ? "text-rail" : "text-ink"}`}>
        <HeadGlyph state={health.kind} />
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-sm leading-6">
        <span className="mono text-ink-2">HEAD</span>
        <span className={ok ? "text-ink-2" : "font-medium text-ink"}>{health.line}</span>
      </span>
    </Link>
  );
}
