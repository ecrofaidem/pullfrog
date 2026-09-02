// Hand run-context a Codex chain that will outlive the run. Exactly one caller
// rotates a chain at a time: the lease is claimed in a mutation (serializable),
// the refresh happens out here where fetch is allowed, and everyone who lost
// the claim re-reads until the winner commits. See action/utils/codexHome.ts
// for why the chain cannot live in GitHub Actions secrets.

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  codexNeedsRefresh,
  OAuthInvalidGrantError,
  parseCodexAuthBody,
  refreshCodexAuthBody,
  stringifyCodexAuthBody,
} from "./codexOAuth";
import { open, seal } from "./crypto";
import { sleep } from "./http";

const WAIT_BUDGET_MS = 25_000;
const POLL_MS = 500;

export async function freshCodexChain(
  ctx: ActionCtx,
  initialRow: Doc<"secrets">,
  initialPlaintext: string
): Promise<string> {
  let row = initialRow;
  let raw = initialPlaintext;
  const deadline = Date.now() + WAIT_BUDGET_MS;

  for (;;) {
    const body = parseCodexAuthBody(raw);
    // malformed: hand it over unchanged; the action logs and ignores it.
    if (!body || !codexNeedsRefresh(body)) return raw;

    const claim = await ctx.runMutation(internal.secrets.claimLease, {
      id: row._id,
      updatedAt: row.updatedAt,
    });

    if (claim === "granted") {
      try {
        const rotated = await refreshCodexAuthBody(body);
        const text = stringifyCodexAuthBody(rotated);
        await ctx.runMutation(internal.secrets.commitRefresh, { id: row._id, ...(await seal(text)) });
        return text;
      } catch (err) {
        if (err instanceof OAuthInvalidGrantError && err.chainIsDead) {
          const latched = { ...body, refresh_rejected_at: new Date().toISOString() };
          const text = stringifyCodexAuthBody(latched);
          await ctx.runMutation(internal.secrets.markRejected, {
            id: row._id,
            ...(await seal(text)),
            reason: err.message.slice(0, 500),
          });
          return text;
        }
        // transient provider trouble: release and hand over what we have.
        await ctx.runMutation(internal.secrets.releaseLease, { id: row._id });
        console.warn(`codex refresh failed, serving current chain: ${String(err)}`);
        return raw;
      }
    }

    if (Date.now() > deadline) return raw;
    await sleep(POLL_MS);
    const latest = await ctx.runQuery(internal.secrets.getById, { id: row._id });
    if (!latest) return raw;
    row = latest;
    raw = await open(latest);
  }
}
