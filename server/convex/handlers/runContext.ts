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

  const rows = await ctx.runQuery(internal.secrets.visibleTo, {
    owner: identity.owner,
    repo: identity.repo,
  });
  const dbSecrets: Record<string, string> = {};
  for (const row of rows) {
    let value = await open(row);
    if (row.name === "CODEX_AUTH_JSON") value = await freshCodexChain(ctx, row, value);
    dbSecrets[row.name] = value;
  }

  const apiToken = await mintRunToken({
    owner: identity.owner,
    repo: identity.repo,
    runId: identity.runId,
  });

  return json({
    settings: toActionSettings(repoDoc),
    apiToken,
    oss: false,
    plan: "none",
    dbSecrets,
    secretsUnavailable: false,
    routerUnfunded: false,
  });
});
