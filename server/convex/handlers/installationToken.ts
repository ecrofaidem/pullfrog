// POST /api/github/installation-token[?repos=a,b]
// Authorization: Bearer <GitHub Actions OIDC token>
// body: { permissions?: { contents: "write", ... } }
//
// The action calls this for its git token, its MCP token and mid-run re-mints
// (action/utils/github.ts acquireTokenViaOIDC). The OIDC `repository` claim is
// the only input we trust; the `repos` query is upstream's cross-repo feature
// and anything beyond the calling repo is refused.

import { httpAction } from "../_generated/server";
import { type AppPermissions, appSlug, createInstallationToken, findRepoInstallation } from "../lib/github";
import { error, json } from "../lib/http";
import { bearerToken, verifyActionsOidc } from "../lib/oidc";

export const installationToken = httpAction(async (_ctx, request) => {
  const oidc = bearerToken(request);
  if (!oidc) return error(401, "missing OIDC bearer token");

  let identity;
  try {
    identity = await verifyActionsOidc(oidc);
  } catch (err) {
    return error(403, `OIDC token rejected: ${err instanceof Error ? err.message : String(err)}`);
  }

  const requested = (new URL(request.url).searchParams.get("repos") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const foreign = requested.filter((name) => name !== identity.repo);
  if (foreign.length > 0) {
    return error(403, `this server mints single-repo tokens only; refused: ${foreign.join(", ")}`);
  }

  const body = (await request.json().catch(() => ({}))) as { permissions?: AppPermissions };

  const installation = await findRepoInstallation(identity.owner, identity.repo);
  if (!installation) {
    return error(404, `${appSlug()} is not installed on ${identity.repository}`);
  }

  const minted = await createInstallationToken(installation.id, {
    repositories: [identity.repo],
    ...(body.permissions ? { permissions: body.permissions } : {}),
  });

  return json({
    token: minted.token,
    expires_at: minted.expires_at,
    installation_id: installation.id,
    repository: identity.repository,
    ref: identity.ref,
    runner_environment: identity.runnerEnvironment,
  });
});
