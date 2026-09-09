// POST /webhooks/github — the GitHub App's webhook URL.
// Verifies the HMAC, dedupes on delivery id, and hands the event to
// dispatch.handleEvent on the scheduler so GitHub gets its 2xx immediately.

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { hmacSha256Hex, timingSafeEqual } from "../lib/crypto";
import { error, json } from "../lib/http";
import { selectWebhook } from "../lib/webhookEvent";
import { actionWorkflow } from "../actionVersion";

export const githubWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return error(500, "GITHUB_WEBHOOK_SECRET is not set");

  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${await hmacSha256Hex(secret, raw)}`;
  if (!timingSafeEqual(signature, expected)) return error(401, "bad signature");

  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery");
  if (event === "ping") return json({ ok: true });
  if (!delivery) return error(400, "missing delivery id");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return error(400, "body is not JSON");
  }
  const selected = selectWebhook(event, payload, actionWorkflow());
  if (!selected) return json({ ok: true, ignored: event });
  const fresh = await ctx.runMutation(internal.webhooks.accept, { delivery, ...selected });
  if (!fresh) return json({ ok: true, duplicate: true });
  return json({ ok: true }, 202);
});
