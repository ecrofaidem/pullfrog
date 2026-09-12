// GET /api/repo/:owner/:repo/run-context
// Authorization: Bearer <job GITHUB_TOKEN>   (unused)
// X-GitHub-OIDC-Token: <GitHub Actions OIDC token>
//
// Returns the repo's settings, a per-run bearer for the write-back endpoints,
// and every stored secret the repo may see, with the Codex chain rotated if
// it would not survive the run. Shape: action/utils/runContext.ts fetchRunContext.

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { freshCodexChain } from "../lib/codexRefresh";
import { startCodexPool } from "../lib/codexPool";
import { open } from "../lib/crypto";
import { error, json, pathAfter } from "../lib/http";
import { verifyActionsOidc } from "../lib/oidc";
import { mintRunToken } from "../lib/runToken";
import { toActionSettings } from "../repos";

export const runContext = httpAction(async (ctx, request) => {
  const [owner, repo, tail, ...rest] = pathAfter(request, "/api/repo/");
  if (!owner || !repo || tail !== "run-context" || rest.length > 0) {
    return error(404, "not found");
  }

  const oidc = request.headers.get("x-github-oidc-token");
  if (!oidc) return error(403, "X-GitHub-OIDC-Token header required");

  let identity;
  try {
    identity = await verifyActionsOidc(oidc);
  } catch (err) {
    return error(403, `OIDC token rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (identity.owner.toLowerCase() !== owner.toLowerCase() || identity.repo.toLowerCase() !== repo.toLowerCase()) {
    return error(403, `OIDC repository ${identity.repository} does not match ${owner}/${repo}`);
  }

  const repoDoc = await ctx.runQuery(internal.repos.get, { owner: identity.owner, name: identity.repo });
  if (!repoDoc || !repoDoc.enabled) {
    return error(404, `${identity.repository} is not enabled on this server`);
  }

  const pool = await ctx.runQuery(internal.codexAccounts.getPool, { owner: identity.owner, repo: identity.repo });
  const required = request.headers.get("x-pullfrog-codex-pool-required") === "1";
  const runtimeInstance = request.headers.get("x-pullfrog-run-instance") ?? "";
  const agent = request.headers.get("x-pullfrog-agent")?.trim();
  if (pool?.enabled || required) {
    if (!pool?.enabled || !required || request.headers.get("x-pullfrog-codex-pool") !== "1" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runtimeInstance) ||
        !/^[1-9][0-9]*$/.test(identity.runId) || !/^[1-9][0-9]*$/.test(identity.runAttempt) ||
        request.headers.get("x-pullfrog-codex-external-auth") === "1" ||
        (agent && agent !== "codex") || (!repoDoc.codexAgent && agent !== "codex")) {
      return json({ codexPool: { status: "denied", reason: "configuration" } }, 400);
    }
  }

  const rows = await ctx.runQuery(internal.secrets.visibleTo, {
    owner: identity.owner,
    repo: identity.repo,
  });
  const dbSecrets: Record<string, string> = {};
  for (const row of rows) {
    if (pool?.enabled && ["CODEX_AUTH_JSON", "CODEX_API_KEY", "OPENAI_API_KEY"].includes(row.name)) continue;
    let value = await open(row);
    if (row.name === "CODEX_AUTH_JSON") value = await freshCodexChain(ctx, row, value);
    dbSecrets[row.name] = value;
  }

  const apiToken = await mintRunToken({
    owner: identity.owner,
    repo: identity.repo,
    runId: identity.runId,
  });

  const pooled = pool?.enabled ? await startCodexPool(ctx, {
    owner: identity.owner, repo: identity.repo, runId: identity.runId, runAttempt: identity.runAttempt, runtimeInstance,
  }) : undefined;
  if (pooled?.status === "denied") {
    return json({ codexPool: pooled }, pooled.reason === "configuration" ? 400 : pooled.reason === "unknown" ? 503 : 409);
  }
  if (pooled?.status === "assigned") dbSecrets.CODEX_AUTH_JSON = pooled.auth;

  return json({
    settings: toActionSettings(repoDoc),
    apiToken,
    oss: false,
    plan: "none",
    dbSecrets,
    secretsUnavailable: false,
    routerUnfunded: false,
    ...(pooled?.status === "assigned" ? { codexPool: pooled.codexPool } : {}),
  });
});
