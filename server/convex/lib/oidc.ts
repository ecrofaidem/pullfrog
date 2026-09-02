// GitHub Actions OIDC verification. The action mints an ID token with audience
// `pullfrog-api` (see action/utils/github.ts OIDC_AUDIENCE) and presents it in
// one of two places:
//   - installation-token: `Authorization: Bearer <oidc>`
//   - run-context:        `X-GitHub-OIDC-Token: <oidc>` (Authorization carries
//                         the job's GITHUB_TOKEN, which we don't use)
// The verified `repository` claim is the only thing that decides which repo's
// settings and secrets a caller gets.

import { verifyRs256 } from "./jwt";

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
export const OIDC_AUDIENCE = "pullfrog-api";

export interface ActionsIdentity {
  repository: string;
  owner: string;
  repo: string;
  runId: string;
  ref: string;
  runnerEnvironment: string;
  actor: string | undefined;
}

export async function verifyActionsOidc(token: string): Promise<ActionsIdentity> {
  const claims = await verifyRs256(token, {
    jwksUrl: JWKS_URL,
    issuer: ISSUER,
    audience: OIDC_AUDIENCE,
  });
  const repository = typeof claims.repository === "string" ? claims.repository : "";
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("OIDC token carries no repository claim");
  return {
    repository,
    owner,
    repo,
    runId: String(claims.run_id ?? ""),
    ref: String(claims.ref ?? ""),
    runnerEnvironment: String(claims.runner_environment ?? ""),
    actor: typeof claims.actor === "string" ? claims.actor : undefined,
  };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
