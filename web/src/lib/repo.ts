// Which repo the dashboard is looking at. One repo during the trial; when more
// are enabled the header grows a switcher and this hook reads the search param.

import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { api } from "@server/_generated/api";
import type { Doc } from "@server/_generated/dataModel";

export const reposQuery = convexQuery(api.repos.list, {});

export function useRepos(): Doc<"repos">[] {
  const { data } = useSuspenseQuery(reposQuery);
  return [...data].sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
}

export function useCurrentRepo(): Doc<"repos"> | undefined {
  const repos = useRepos();
  const search = useSearch({ strict: false }) as { repo?: string };
  if (search.repo) {
    const match = repos.find((r) => `${r.owner}/${r.name}` === search.repo);
    if (match) return match;
  }
  return repos.find((r) => r.enabled) ?? repos[0];
}

export function fullName(repo: Pick<Doc<"repos">, "owner" | "name">): string {
  return `${repo.owner}/${repo.name}`;
}
