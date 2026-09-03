// Authenticated shell: the top strip (repo ref, tabs, who is signed in) and
// the content column every page lives in.

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { HealthLine } from "~/components/health-line";
import { authClient } from "~/lib/auth-client";
import { DEV_BYPASS_AUTH } from "~/lib/dev";
import { fullName, healthQuery, meQuery, pickRepo, reposQuery, useCurrentRepo, useRepos } from "~/lib/repo";

export const Route = createFileRoute("/_app")({
  validateSearch: (search: Record<string, unknown>): { repo?: string } =>
    typeof search.repo === "string" ? { repo: search.repo } : {},
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated && !DEV_BYPASS_AUTH) throw redirect({ to: "/sign-in" });
  },
  loaderDeps: ({ search }) => ({ repo: search.repo }),
  // everything the shell itself renders is warm before the first paint; the
  // health subscription lives here so every view shares it.
  loader: async ({ context, deps }) => {
    const [repos] = await Promise.all([
      context.queryClient.ensureQueryData(reposQuery),
      context.queryClient.ensureQueryData(meQuery),
    ]);
    const repo = pickRepo(repos, deps.repo);
    if (repo) await context.queryClient.ensureQueryData(healthQuery(repo));
  },
  component: AppShell,
});

const tabs = [
  { to: "/", label: "Runs" },
  { to: "/settings", label: "Settings" },
  { to: "/credentials", label: "Credentials" },
] as const;

function AppShell() {
  const repos = useRepos();
  const repo = useCurrentRepo();
  const navigate = useNavigate();
  const onRuns = useLocation({ select: (l) => l.pathname }) === "/";
  const { data: me } = useSuspenseQuery(meQuery);

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/sign-in");
  }

  return (
    <div className="mx-auto w-full max-w-[72ch] px-5 pb-24 pt-5 sm:pt-7">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {repos.length > 1 ? (
          <label className="mono text-base">
            <span className="sr-only">Repository</span>
            <select
              className="field w-auto"
              value={repo ? fullName(repo) : ""}
              onChange={(e) => navigate({ to: ".", search: { repo: e.target.value } })}
            >
              {repos.map((r) => (
                <option key={r._id} value={fullName(r)}>
                  {fullName(r)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="mono py-1.5 text-base text-ink">{repo ? fullName(repo) : "no repo yet"}</span>
        )}
        <nav aria-label="Sections" className="flex gap-3 text-sm">
          {tabs.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              search={(prev) => prev}
              className="tab"
              activeProps={{ className: "tab tab-active" }}
              activeOptions={{ exact: t.to === "/" }}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto flex items-center gap-2 text-sm text-ink-3">
          <span className="mono">{me.login}</span>
          <button type="button" className="tab text-ink-2 underline hover:text-ink" onClick={signOut}>
            sign out
          </button>
        </span>
      </header>

      {repo && !onRuns && <HealthLine repo={repo} />}

      <main className="mt-7">
        {repo ? (
          <Outlet />
        ) : (
          <p className="max-w-[48ch] text-base text-ink-2">
            The bot is not installed on any repository yet. Install the GitHub App on a repo. This
            page fills in when the first GitHub event arrives.
          </p>
        )}
      </main>
    </div>
  );
}
