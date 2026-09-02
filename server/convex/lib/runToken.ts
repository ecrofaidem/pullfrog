// The `apiToken` run-context hands the action. The action sends it back as a
// bearer on PATCH /api/workflow-run/:id and PUT /api/runtime/secret, and the
// post step keeps using it after the job's OIDC window has closed — so it has
// to outlive the job by a margin. 24h covers the action's 1h default timeout
// plus a stuck post step, and it can only touch the repo it was minted for.

import { signHs256, verifyHs256 } from "./jwt";

export interface RunTokenClaims {
  owner: string;
  repo: string;
  runId: string;
}

function secret(): string {
  const value = process.env.RUN_TOKEN_SECRET;
  if (!value) throw new Error("RUN_TOKEN_SECRET is not set");
  return value;
}

export async function mintRunToken(claims: RunTokenClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signHs256({ sub: "run", ...claims, iat: now, exp: now + 24 * 60 * 60 }, secret());
}

export async function verifyRunToken(token: string): Promise<RunTokenClaims> {
  const claims = await verifyHs256(token, secret());
  if (claims.sub !== "run" || typeof claims.owner !== "string" || typeof claims.repo !== "string") {
    throw new Error("not a run token");
  }
  return { owner: claims.owner, repo: claims.repo, runId: String(claims.runId ?? "") };
}
