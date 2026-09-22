// GET  /api/cli/secrets?owner=&repo=
// POST /api/cli/secrets   { owner, repo, name, value, scope: "account" | "repo" }
// Authorization: Bearer <the user's `gh auth token`>
//
// What `npx pullfrog auth codex` talks to (action/commands/_shared.ts
// fetchStatus / setPullfrogSecret). The caller proves who they are with their
// own GitHub token; they must have push access to the repo to read or write.

import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getCodexProviderAccountId } from "../lib/codexIdentity";
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
  isOrgAdministrator,
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

  if (url.searchParams.has("codexPool")) {
    if (url.searchParams.get("codexPool") !== "1") return error(400, "invalid Codex pool request");
    return codexManagement(ctx, request, { owner, repo, scope: url.searchParams.get("scope") ?? "repo" });
  }

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
    operation?: unknown;
  } | null;
  if (body && typeof body === "object" && "operation" in body) return codexManagement(ctx, request, body as Record<string, unknown>);
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

/** GitHub operator authority is checked independently of all runtime capabilities. */
async function codexManagement(ctx: ActionCtx, request: Request, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.owner !== "string" || typeof body.repo !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(body.owner.trim()) || !/^[a-zA-Z0-9_.-]+$/.test(body.repo.trim()) ||
      (body.scope !== "repo" && body.scope !== "account")) return error(400, "owner, repo, and a valid scope are required");
  const owner = body.owner.trim().toLowerCase();
  const repo = body.repo.trim().toLowerCase();
  const scope = body.scope;
  try {
    const auth = await authorize(request, owner, repo);
    if (auth instanceof Response) return auth;
    const ownerAdmin = async () => auth.isOrg
      ? isOrgAdministrator(bearerToken(request)!, owner)
      : auth.login.toLowerCase() === owner;
    if (scope === "account" && !await ownerAdmin()) return error(403, "owner administration required");
    if (!await findRepoInstallation(owner, repo)) return await notInstalled(owner, auth.isOrg);
    const scoped = { owner, repo: scope === "account" ? null : repo };
    if (request.method === "POST") {
      switch (body.operation) {
        case "codex-enroll":
        case "codex-replace": {
          if (typeof body.value !== "string") return error(400, "a complete Codex auth body is required");
          const providerAccountId = getCodexProviderAccountId(body.value);
          const parsed = parseCodexAuthBody(body.value);
          if (!providerAccountId || !parsed) return error(400, "a complete Codex auth body with consistent account identity is required");
          parsed.tokens.account_id = providerAccountId;
          const credentials = { ...scoped, providerAccountId, ...await seal(JSON.stringify(parsed)) };
          if (body.operation === "codex-enroll") {
            if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 100) return error(400, "account label must be 1 to 100 characters");
            await ctx.runMutation(internal.codexAccounts.enroll, { ...credentials, label: body.label });
          } else {
            if (typeof body.accountId !== "string" || !body.accountId) return error(400, "accountId is required");
            await ctx.runMutation(internal.codexAccounts.replace, { ...credentials, accountId: body.accountId as Id<"codexAccounts"> });
          }
          break;
        }
        case "codex-enable":
          if (typeof body.accountId !== "string" || !body.accountId || typeof body.enabled !== "boolean") return error(400, "accountId and boolean enabled are required");
          await ctx.runMutation(internal.codexAccounts.setEnabled, { ...scoped, accountId: body.accountId as Id<"codexAccounts">, enabled: body.enabled });
          break;
        case "codex-pool":
          if (!Array.isArray(body.accountIds) || !body.accountIds.every((id) => typeof id === "string" && id) ||
              (body.enabled !== undefined && typeof body.enabled !== "boolean")) return error(400, "accountIds and optional boolean enabled are required");
          await ctx.runMutation(internal.codexAccounts.configurePool, {
            owner, repo, accountIds: body.accountIds as Id<"codexAccounts">[],
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }), allowOwnerAccounts: await ownerAdmin(),
          });
          break;
        default: return error(400, "unknown Codex account operation");
      }
    }
    const status = await ctx.runQuery(internal.codexAccounts.status, { owner, repo, scope });
    return json({ ...(request.method === "POST" ? { success: true } : {}), ...status });
  } catch (cause) {
    if (cause instanceof ConvexError && cause.data === "owner administration required") return error(403, "owner administration required");
    // Provider responses, credential bodies, and database validation details stay private.
    return error(400, "Codex account operation failed; check account scope, identity, and pool membership");
  }
}
