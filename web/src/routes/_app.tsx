// Authenticated shell: the top strip (repo ref, tabs, who is signed in) and
// the content column every page lives in.

import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { api } from "@server/_generated/api";
import { HealthLine } from "~/components/health-line";
import { authClient } from "~/lib/auth-client";
import { fullName, reposQuery, useCurrentRepo, useRepos } from "~/lib/repo";

// mirrors DASHBOARD_DEV_BYPASS on the Convex side; both must be set for it to work
const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === "1";

export const Route = createFileRoute("/_app")({
  validateSearch: (search: Record<string, unknown>): { repo?: string } =>
    typeof search.repo === "string" ? { repo: search.repo } : {},
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated && !DEV_BYPASS) throw redirect({ to: "/sign-in" });
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(reposQuery);
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
  const { data: me } = useSuspenseQuery(convexQuery(api.me.get, {}));

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/sign-in");
  }

  return (
    <div className="mx-auto w-full max-w-[72ch] px-5 pb-24 pt-6 sm:pt-8">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
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
          <span className="mono text-base text-ink">{repo ? fullName(repo) : "no repo yet"}</span>
        )}
        <nav aria-label="Sections" className="flex gap-4 text-sm">
          {tabs.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              search={(prev) => prev}
              className="border-b border-transparent pb-0.5 text-ink-2 hover:text-ink"
              activeProps={{ className: "border-b border-ink pb-0.5 text-ink" }}
              activeOptions={{ exact: t.to === "/" }}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto flex items-center gap-3 text-sm text-ink-3">
          <span className="mono">{me.login}</span>
          <button type="button" className="text-ink-2 underline hover:text-ink" onClick={signOut}>
            sign out
          </button>
        </span>
      </header>

      {repo && !onRuns && <HealthLine repo={repo} />}

      <main className="mt-8">
        {repo ? (
          <Outlet />
        ) : (
          <p className="max-w-[48ch] text-base text-ink-2">
            frogbot is not installed on any repository yet. Install the GitHub App on a repo and
            this page fills in when the first webhook arrives.
          </p>
        )}
      </main>
    </div>
  );
}
