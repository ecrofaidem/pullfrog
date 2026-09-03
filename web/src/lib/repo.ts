// Which repo the dashboard is looking at, and the query factories every view
// shares. One factory per dataset means one query key, one subscription, and
// a loader can warm exactly what the page will read.

import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { api } from "@server/_generated/api";
import type { Doc } from "@server/_generated/dataModel";

export const RUNS_LIMIT = 100;

export type RepoRef = Pick<Doc<"repos">, "owner" | "name">;

export const reposQuery = convexQuery(api.repos.list, {});
export const meQuery = convexQuery(api.me.get, {});
export const runsQuery = (repo: RepoRef) =>
  convexQuery(api.runs.list, { owner: repo.owner, repo: repo.name, limit: RUNS_LIMIT });
export const healthQuery = (repo: RepoRef) =>
  convexQuery(api.health.get, { owner: repo.owner, repo: repo.name });
export const secretsQuery = (repo: RepoRef) =>
  convexQuery(api.secrets.status, { owner: repo.owner, repo: repo.name });

export function fullName(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

export function sortRepos(repos: Doc<"repos">[]): Doc<"repos">[] {
  return [...repos].sort((a, b) => fullName(a).localeCompare(fullName(b)));
}

/** the same choice the shell makes, usable from a loader before any component renders. */
export function pickRepo(repos: Doc<"repos">[], wanted: string | undefined): Doc<"repos"> | undefined {
  const sorted = sortRepos(repos);
  if (wanted) {
    const match = sorted.find((r) => fullName(r) === wanted);
    if (match) return match;
  }
  return sorted.find((r) => r.enabled) ?? sorted[0];
}

export function useRepos(): Doc<"repos">[] {
  const { data } = useSuspenseQuery(reposQuery);
  return sortRepos(data);
}

export function useCurrentRepo(): Doc<"repos"> | undefined {
  const repos = useRepos();
  const search = useSearch({ strict: false }) as { repo?: string };
  return pickRepo(repos, search.repo);
}
