// PUT /api/runtime/secret   { name, value }
// Authorization: Bearer <run token from run-context>
//
// The action's always-run post step sends the rotated Codex chain here
// (action/entryPost.ts). The row is written back at whatever scope it was read
// from, so an account-scoped chain stays shared.

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseCodexAuthBody } from "../lib/codexOAuth";
import { seal } from "../lib/crypto";
import { error, json } from "../lib/http";
import { bearerToken } from "../lib/oidc";
import { verifyRunToken } from "../lib/runToken";

export const runtimeSecretPut = httpAction(async (ctx, request) => {
  const token = bearerToken(request);
  if (!token) return error(401, "missing run token");
  let run;
  try {
    run = await verifyRunToken(token);
  } catch {
    return error(403, "run token rejected");
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown; value?: unknown } | null;
  if (!body || typeof body.name !== "string" || typeof body.value !== "string") {
    return error(400, "expected { name, value }");
  }
  if (body.name === "CODEX_AUTH_JSON" && !parseCodexAuthBody(body.value)) {
    return error(400, "CODEX_AUTH_JSON value is not a Codex auth.json body");
  }

  const existing = await ctx.runQuery(internal.secrets.resolve, {
    owner: run.owner,
    repo: run.repo,
    name: body.name,
  });
  const sealed = await seal(body.value);
  await ctx.runMutation(internal.secrets.upsert, {
    owner: run.owner,
    repo: existing ? existing.repo : run.repo,
    name: body.name,
    ...sealed,
    updatedBy: `run:${run.runId || "unknown"}`,
  });
  return json({ success: true });
});
