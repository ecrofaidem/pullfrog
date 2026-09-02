// GET  /api/cli/secrets?owner=&repo=
// POST /api/cli/secrets   { owner, repo, name, value, scope: "account" | "repo" }
// Authorization: Bearer <the user's `gh auth token`>
//
// What `npx pullfrog auth codex` talks to (action/commands/_shared.ts
// fetchStatus / setPullfrogSecret). The caller proves who they are with their
// own GitHub token; they must have push access to the repo to read or write.

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseCodexAuthBody } from "../lib/codexOAuth";
import { seal } from "../lib/crypto";
import {
  appSlug,
  findOwnerInstallation,
  findRepoInstallation,
  getAuthenticatedUser,
  getRepoAsUser,
} from "../lib/github";
import { error, json } from "../lib/http";
import { bearerToken } from "../lib/oidc";

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

async function authorize(
  request: Request,
  owner: string,
  repo: string
): Promise<{ login: string; defaultBranch: string; isOrg: boolean } | Response> {
  const token = bearerToken(request);
  if (!token) return error(401, "missing GitHub token");
  const user = await getAuthenticatedUser(token);
  if (!user) return error(401, "invalid or expired github token");
  const repoInfo = await getRepoAsUser(token, owner, repo);
  if (!repoInfo) return error(404, `repository ${owner}/${repo} not found`, { appSlug: appSlug() });
  const canPush = repoInfo.permissions?.push || repoInfo.permissions?.admin || repoInfo.permissions?.maintain;
  if (!canPush) return error(403, `you need push access to ${owner}/${repo} to manage its secrets`);
  return { login: user.login, defaultBranch: repoInfo.default_branch, isOrg: repoInfo.owner.type === "Organization" };
}

async function notInstalled(owner: string, isOrg: boolean): Promise<Response> {
  const ownerInstallation = await findOwnerInstallation(owner);
  return json(
    {
      error: `${appSlug()} is not installed on ${owner}`,
      appSlug: appSlug(),
      installationId: ownerInstallation?.id ?? null,
      repositorySelection: ownerInstallation?.repository_selection ?? null,
      isOrg,
    },
    404
  );
}

export const cliSecretsGet = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") ?? "";
  const repo = url.searchParams.get("repo") ?? "";
  if (!owner || !repo) return error(400, "owner and repo are required");

  const auth = await authorize(request, owner, repo);
  if (auth instanceof Response) return auth;

  const installation = await findRepoInstallation(owner, repo);
  if (!installation) return notInstalled(owner, auth.isOrg);

  await ctx.runMutation(internal.repos.recordInstallation, {
    owner,
    installationId: installation.id,
    isOrg: auth.isOrg,
    repositorySelection: installation.repository_selection,
    suspended: installation.suspended_at !== null,
  });
  const repoDoc = await ctx.runMutation(internal.repos.ensure, {
    owner,
    name: repo,
    defaultBranch: auth.defaultBranch,
  });
  const names = await ctx.runQuery(internal.secrets.names, { owner, repo });
  const runs = await ctx.runQuery(internal.runs.recent, { owner, repo, limit: 1 });

  return json({
    appSlug: appSlug(),
    installationId: installation.id,
    repositorySelection: installation.repository_selection,
    isOrg: auth.isOrg,
    accessible: true,
    repoSecrets: [],
    orgSecrets: [],
    pullfrogSecrets: [...new Set([...names.account, ...names.repo])],
    repoStatus: repoDoc.enabled ? "active" : "disabled",
    repoModel: repoDoc.model,
    hasRuns: runs.length > 0,
  });
});

export const cliSecretsPost = httpAction(async (ctx, request) => {
  const body = (await request.json().catch(() => null)) as {
    owner?: unknown;
    repo?: unknown;
    name?: unknown;
    value?: unknown;
    scope?: unknown;
  } | null;
  if (
    !body ||
    typeof body.owner !== "string" ||
    typeof body.repo !== "string" ||
    typeof body.name !== "string" ||
    typeof body.value !== "string"
  ) {
    return error(400, "expected { owner, repo, name, value, scope }");
  }
  const scope = body.scope === "account" ? "account" : "repo";
  if (!SECRET_NAME_RE.test(body.name)) return error(400, "secret name must be UPPER_SNAKE_CASE");
  if (body.name === "CODEX_AUTH_JSON" && !parseCodexAuthBody(body.value)) {
    return error(400, "CODEX_AUTH_JSON value is not a Codex auth.json body");
  }

  const auth = await authorize(request, body.owner, body.repo);
  if (auth instanceof Response) return auth;

  const installation = await findRepoInstallation(body.owner, body.repo);
  if (!installation) return notInstalled(body.owner, auth.isOrg);

  await ctx.runMutation(internal.repos.ensure, {
    owner: body.owner,
    name: body.repo,
    defaultBranch: auth.defaultBranch,
  });
  const sealed = await seal(body.value);
  await ctx.runMutation(internal.secrets.upsert, {
    owner: body.owner,
    repo: scope === "account" ? null : body.repo,
    name: body.name,
    ...sealed,
    updatedBy: auth.login,
  });
  return json({ success: true });
});
