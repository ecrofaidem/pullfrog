import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getCodexProviderAccountId } from "../lib/codexIdentity";
import { open, seal } from "../lib/crypto";
import { error, json } from "../lib/http";
import { bearerToken } from "../lib/oidc";

/** This capability authorizes only finalization of its selected assignment. */
export const codexPoolPost = httpAction(async (ctx, request) => {
  const ownershipToken = bearerToken(request);
  if (!ownershipToken) return error(401, "missing assignment capability");
  const body = await request.json().catch(() => null) as {
    assignmentId?: unknown; childStopped?: unknown; auth?: { kind?: unknown; value?: unknown };
  } | null;
  if (!body || typeof body.assignmentId !== "string") return error(400, "expected assignmentId");
  const state = await ctx.runQuery(internal.codexAssignments.finalizationState, { assignmentId: body.assignmentId, ownershipToken });
  if (!state) return error(403, "assignment capability rejected");
  if (body.childStopped !== true) return error(409, "child stop must be confirmed");
  if (state.assignment.finalizationStatus) return json({ status: state.assignment.finalizationStatus });
  if (state.assignment.phase !== "active") return error(409, "assignment is not active");
  const kind = body.auth?.kind;
  if (kind !== "snapshot" && kind !== "unchanged" && kind !== "uncertain") return error(400, "expected final auth result");
  let auth: { kind: "snapshot"; ciphertext: string; iv: string; providerAccountId: string } | { kind: "unchanged" | "uncertain" } = { kind: "uncertain" };
  try {
    const raw = kind === "snapshot" && typeof body.auth?.value === "string" ? body.auth.value :
      kind === "unchanged" && state.account?.authState === "ready" ? await open(state.account) : null;
    const providerAccountId = raw === null ? null : getCodexProviderAccountId(raw);
    if (providerAccountId && providerAccountId === state.account?.providerAccountId) {
      if (kind === "snapshot" && raw !== null) {
        const snapshot = JSON.parse(raw) as { tokens: { account_id?: string } };
        const normalized = snapshot.tokens.account_id ? raw : JSON.stringify({ ...snapshot, tokens: { ...snapshot.tokens, account_id: providerAccountId } });
        auth = { kind, providerAccountId, ...await seal(normalized) };
      } else auth = { kind: "unchanged" };
    }
  } catch { /* A stopped runner with unreadable final auth requires reenrollment. */ }
  const result = await ctx.runMutation(internal.codexAssignments.finalize, {
    assignmentId: state.assignment._id, ownershipToken, generation: state.assignment.generation,
    credentialVersion: state.assignment.credentialVersion, auth,
  });
  return result ? json(result) : error(409, "assignment changed during finalization");
});
