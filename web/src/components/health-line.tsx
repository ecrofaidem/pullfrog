// The one-line health banner every non-Runs view carries under the header:
// the same HEAD sentence the rail starts from, without the rail.

import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@server/_generated/api";
import type { Doc } from "@server/_generated/dataModel";
import { HeadGlyph } from "~/components/glyphs";
import { deriveHealth } from "~/lib/health";

export function HealthLine({ repo }: { repo: Doc<"repos"> }) {
  const args = { owner: repo.owner, repo: repo.name };
  const { data: runs } = useSuspenseQuery(convexQuery(api.runs.list, { ...args, limit: 3 }));
  const { data: secrets } = useSuspenseQuery(convexQuery(api.secrets.status, args));
  const health = deriveHealth(secrets, runs);
  const ok = health.kind === "ok";

  return (
    <Link
      to="/"
      search={(prev) => prev}
      className="mt-4 grid grid-cols-[28px_1fr] items-start gap-x-2 no-underline"
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
