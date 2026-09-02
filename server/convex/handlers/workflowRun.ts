// PATCH /api/workflow-run/:githubRunId   { model, agent, credential, inputTokens, ... }
// Authorization: Bearer <run token>
//
// Incremental facts the action reports during and at the end of a run
// (action/utils/patchWorkflowRunFields.ts). A 404 here makes the action stop
// reporting for the rest of the run, so unknown runs are created, not refused.

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { error, json, pathAfter } from "../lib/http";
import { bearerToken } from "../lib/oidc";
import { verifyRunToken } from "../lib/runToken";

export const workflowRunPatch = httpAction(async (ctx, request) => {
  const [idText, ...rest] = pathAfter(request, "/api/workflow-run/");
  const githubRunId = Number(idText);
  if (!idText || rest.length > 0 || !Number.isFinite(githubRunId)) return error(404, "not found");

  const token = bearerToken(request);
  if (!token) return error(401, "missing run token");
  let run;
  try {
    run = await verifyRunToken(token);
  } catch {
    return error(403, "run token rejected");
  }

  const fields = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!fields || typeof fields !== "object") return error(400, "expected a JSON object");

  await ctx.runMutation(internal.runs.patchFromAction, {
    owner: run.owner,
    repo: run.repo,
    githubRunId,
    fields,
  });
  return json({ ok: true });
});
