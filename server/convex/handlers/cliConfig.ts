// GET   /api/cli/config?owner=&repo=          → { "review.authors": [...], "run.timeout": "1h", ... }
// PATCH /api/cli/config { owner, repo, set }  → the updated config
// Authorization: Bearer <the user's `gh auth token`>
//
// The keys are the same ones the dashboard's Settings page labels its rows
// with (convex/configKeys.ts). Validation is the dashboard's, so the two
// surfaces cannot disagree about what a value may be.

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { CONFIG_KEY_LIST, fromConfig, toConfig } from "../configKeys";
import { getAuthenticatedUser, getRepoAsUser } from "../lib/github";
import { error, json } from "../lib/http";
import { bearerToken } from "../lib/oidc";
import type { RepoPatch } from "../repos";

async function authorize(request: Request, owner: string, repo: string) {
  const token = bearerToken(request);
  if (!token) return error(401, "missing GitHub token");
  const user = await getAuthenticatedUser(token);
  if (!user) return error(401, "invalid or expired github token");
  const info = await getRepoAsUser(token, owner, repo);
  if (!info) return error(404, `repository ${owner}/${repo} not found`);
  const canPush = info.permissions?.push || info.permissions?.admin || info.permissions?.maintain;
  if (!canPush) return error(403, `you need push access to ${owner}/${repo} to change its config`);
  return { login: user.login };
}

export const cliConfigGet = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") ?? "";
  const repo = url.searchParams.get("repo") ?? "";
  if (!owner || !repo) return error(400, "owner and repo are required");
  const auth = await authorize(request, owner, repo);
  if (auth instanceof Response) return auth;
  const doc = await ctx.runQuery(internal.repos.get, { owner, name: repo });
  if (!doc) return error(404, `${owner}/${repo} is not enabled on this server`);
  return json({ keys: CONFIG_KEY_LIST, config: toConfig(doc) });
});

export const cliConfigPatch = httpAction(async (ctx, request) => {
  const body = (await request.json().catch(() => null)) as {
    owner?: unknown;
    repo?: unknown;
    set?: unknown;
  } | null;
  if (
    !body ||
    typeof body.owner !== "string" ||
    typeof body.repo !== "string" ||
    !body.set ||
    typeof body.set !== "object"
  ) {
    return error(400, "expected { owner, repo, set: { <key>: <value> } }");
  }
  const auth = await authorize(request, body.owner, body.repo);
  if (auth instanceof Response) return auth;
  const { patch, unknown } = fromConfig(body.set as Record<string, unknown>);
  if (unknown.length) {
    return error(400, `unknown keys: ${unknown.join(", ")}`, { keys: CONFIG_KEY_LIST });
  }
  try {
    const doc = await ctx.runMutation(internal.repos.applyConfig, {
      owner: body.owner,
      name: body.repo,
      patch: patch as RepoPatch,
      updatedBy: `cli:${auth.login}`,
    });
    return json({ config: toConfig(doc) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(400, message.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0] ?? message);
  }
});
