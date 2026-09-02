// Thin GitHub REST client for the handful of calls this service makes as the
// App (JWT), as an installation (token), or as a user (their gh token).

import { signRs256 } from "./jwt";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`GitHub ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = "GitHubError";
  }
}

export async function gh<T = unknown>(
  path: string,
  options: {
    token: string;
    method?: string;
    body?: unknown;
    accept?: string;
    /** return null instead of throwing on this status (e.g. 404 lookups) */
    tolerate?: number[];
  }
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: options.accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "frogbot-server",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    if (options.tolerate?.includes(response.status)) return null as T;
    throw new GitHubError(response.status, path, await response.text().catch(() => ""));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ── App identity ─────────────────────────────────────────────────────────────

function appConfig(): { appId: string; privateKey: string } {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set");
  }
  return { appId, privateKey };
}

export function appSlug(): string {
  return process.env.GITHUB_APP_SLUG ?? "frogbot";
}

/** a 9-minute App JWT; GitHub caps them at 10 and rejects clock skew > 60s. */
export async function appJwt(): Promise<string> {
  const { appId, privateKey } = appConfig();
  const now = Math.floor(Date.now() / 1000);
  return signRs256({ iat: now - 60, exp: now + 9 * 60, iss: appId }, privateKey);
}

export interface Installation {
  id: number;
  account: { login: string; type: string };
  repository_selection: string;
  suspended_at: string | null;
}

export async function findRepoInstallation(
  owner: string,
  repo: string
): Promise<Installation | null> {
  return gh<Installation | null>(`/repos/${owner}/${repo}/installation`, {
    token: await appJwt(),
    tolerate: [404],
  });
}

export async function findOwnerInstallation(owner: string): Promise<Installation | null> {
  const token = await appJwt();
  const org = await gh<Installation | null>(`/orgs/${owner}/installation`, {
    token,
    tolerate: [404],
  });
  if (org) return org;
  return gh<Installation | null>(`/users/${owner}/installation`, { token, tolerate: [404] });
}

export type ReadWrite = "read" | "write";
export type AppPermissions = Record<string, ReadWrite>;

export interface InstallationAccessToken {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
}

/** mint an installation token, optionally narrowed to repos (by name) and permissions. */
export async function createInstallationToken(
  installationId: number,
  options: { repositories?: string[]; permissions?: AppPermissions } = {}
): Promise<InstallationAccessToken> {
  const body: Record<string, unknown> = {};
  if (options.repositories?.length) body.repositories = options.repositories;
  if (options.permissions && Object.keys(options.permissions).length) {
    body.permissions = options.permissions;
  }
  return gh<InstallationAccessToken>(`/app/installations/${installationId}/access_tokens`, {
    token: await appJwt(),
    method: "POST",
    body,
  });
}

// ── Installation-scoped calls ────────────────────────────────────────────────

export async function dispatchWorkflow(params: {
  token: string;
  owner: string;
  repo: string;
  workflow: string;
  ref: string;
  inputs: Record<string, string>;
}): Promise<void> {
  await gh<void>(
    `/repos/${params.owner}/${params.repo}/actions/workflows/${encodeURIComponent(params.workflow)}/dispatches`,
    { token: params.token, method: "POST", body: { ref: params.ref, inputs: params.inputs } }
  );
}

export async function createCheckRun(params: {
  token: string;
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  detailsUrl?: string;
}): Promise<{ id: number }> {
  return gh<{ id: number }>(`/repos/${params.owner}/${params.repo}/check-runs`, {
    token: params.token,
    method: "POST",
    body: {
      name: params.name,
      head_sha: params.headSha,
      status: "in_progress",
      started_at: new Date().toISOString(),
      ...(params.detailsUrl ? { details_url: params.detailsUrl } : {}),
    },
  });
}

export async function finalizeCheckRun(params: {
  token: string;
  owner: string;
  repo: string;
  checkRunId: number;
  conclusion: "success" | "failure" | "cancelled" | "timed_out";
  summary: string;
}): Promise<void> {
  await gh<unknown>(`/repos/${params.owner}/${params.repo}/check-runs/${params.checkRunId}`, {
    token: params.token,
    method: "PATCH",
    body: {
      status: "completed",
      conclusion: params.conclusion,
      completed_at: new Date().toISOString(),
      output: { title: params.conclusion, summary: params.summary },
    },
  });
}

export type AuthorPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

/** the triggering user's role on the repo. drives the action's shell tier, so
 * it is resolved here from GitHub rather than trusted from the webhook. */
export async function collaboratorPermission(params: {
  token: string;
  owner: string;
  repo: string;
  login: string;
}): Promise<AuthorPermission> {
  const result = await gh<{ role_name?: string; permission?: string } | null>(
    `/repos/${params.owner}/${params.repo}/collaborators/${encodeURIComponent(params.login)}/permission`,
    { token: params.token, tolerate: [404] }
  );
  const role = result?.role_name ?? result?.permission ?? "none";
  const known: AuthorPermission[] = ["admin", "maintain", "write", "triage", "read", "none"];
  return known.includes(role as AuthorPermission) ? (role as AuthorPermission) : "none";
}

export async function getPullRequest(params: {
  token: string;
  owner: string;
  repo: string;
  number: number;
}): Promise<{
  number: number;
  title: string;
  body: string | null;
  draft: boolean;
  head: { ref: string; sha: string };
  user: { login: string; type: string };
}> {
  return gh(`/repos/${params.owner}/${params.repo}/pulls/${params.number}`, {
    token: params.token,
  });
}

export async function addReaction(params: {
  token: string;
  owner: string;
  repo: string;
  commentId: number;
  content: "eyes" | "+1" | "rocket";
}): Promise<void> {
  await gh<unknown>(
    `/repos/${params.owner}/${params.repo}/issues/comments/${params.commentId}/reactions`,
    { token: params.token, method: "POST", body: { content: params.content } }
  );
}

// ── User-scoped calls (the CLI's gh token) ───────────────────────────────────

export async function getAuthenticatedUser(token: string): Promise<{ login: string } | null> {
  return gh<{ login: string } | null>("/user", { token, tolerate: [401, 403] });
}

export async function getRepoAsUser(
  token: string,
  owner: string,
  repo: string
): Promise<{
  default_branch: string;
  owner: { type: string };
  permissions?: { admin?: boolean; push?: boolean; maintain?: boolean };
} | null> {
  return gh(`/repos/${owner}/${repo}`, { token, tolerate: [404, 403] });
}

/** membership state of a user in an org, via that user's own OAuth token (read:org). */
export async function orgMembershipState(
  userToken: string,
  org: string
): Promise<"active" | "pending" | "none"> {
  const result = await gh<{ state?: string } | null>(`/user/memberships/orgs/${org}`, {
    token: userToken,
    tolerate: [404, 403],
  });
  if (!result) return "none";
  return result.state === "active" ? "active" : "pending";
}
