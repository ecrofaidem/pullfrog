// Usage: will the Codex pool last until its next reset? The verdict leads, the
// coverage strips show who serves each hour from now to that reset, and the
// history, cost and throughput sections below are the evidence for upgrading.

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Usage } from "~/components/usage-view";
import { useNow } from "~/lib/now";
import { pickRepo, reposQuery, usageQuery, useCurrentRepo } from "~/lib/repo";

export const Route = createFileRoute("/_app/usage")({
  loaderDeps: ({ search }) => ({ repo: search.repo }),
  loader: async ({ context, deps }) => {
    const repos = await context.queryClient.ensureQueryData(reposQuery);
    const repo = pickRepo(repos, deps.repo);
    if (repo) await context.queryClient.ensureQueryData(usageQuery(repo));
  },
  pendingComponent: UsageSkeleton,
  component: UsagePage,
});

function UsagePage() {
  const repo = useCurrentRepo()!;
  const { data: report } = useSuspenseQuery(usageQuery(repo));
  const now = useNow();
  if (report.accounts.length === 0) {
    return (
      <p className="max-w-[56ch] text-base text-ink-2">
        Usage tracks the pooled ChatGPT accounts a repo signs in with. This repo has no account
        pool, so there is no limit to project. Pool accounts with{" "}
        <code className="text-ink">npx pullfrog auth codex</code>.
      </p>
    );
  }
  if (!report.poolEnabled) {
    return (
      <p className="max-w-[56ch] text-base text-ink-2">
        This repo's account pool is turned off, so runs sign in with the single saved login and no
        pooled limit applies. Turn the pool on to see its coverage here.
      </p>
    );
  }
  // times and projections are local to the reader and move with the clock, so they wait for it
  if (now === null) return <UsageSkeleton />;
  return <Usage report={report} now={now} />;
}

function UsageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading usage">
      <div className="grid grid-cols-[28px_1fr] gap-x-2">
        <span className="flex h-6 items-center justify-center"><span className="bone size-3 rounded-full" /></span>
        <div className="pt-1.5">
          <span className="bone block h-3 w-3/4" />
          <span className="bone mt-2.5 block h-2.5 w-1/2" />
        </div>
      </div>
      <span className="bone mt-10 block h-4 w-48" />
      <span className="bone mt-4 block h-6 w-full" />
      <span className="bone mt-4 block h-6 w-full" />
      <span className="bone mt-12 block h-4 w-40" />
      <span className="bone mt-4 block h-56 w-full" />
    </div>
  );
}
