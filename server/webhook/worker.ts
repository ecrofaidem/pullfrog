import { hmacSha256Hex, timingSafeEqual } from "../convex/lib/crypto";
import { selectWebhook } from "../convex/lib/webhookEvent";

export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  CONVEX_WEBHOOK_URL: string;
  ACTION_WORKFLOW: string;
  REVISION?: string;
}

/** Filter before Convex billing starts. Accepted requests retain GitHub's signed bytes. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/healthz" && request.method === "GET") {
      return Response.json({
        ok: true,
        workflow: env.ACTION_WORKFLOW,
        revision: env.REVISION ?? "dev",
      });
    }
    if (path !== "/webhooks/github" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.GITHUB_WEBHOOK_SECRET || !env.CONVEX_WEBHOOK_URL || !env.ACTION_WORKFLOW) {
      return Response.json({ error: "webhook receiver is not configured" }, { status: 503 });
    }
    const raw = await request.text();
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${await hmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, raw)}`;
    if (!timingSafeEqual(signature, expected)) {
      return Response.json({ error: "bad signature" }, { status: 401 });
    }
    const event = request.headers.get("x-github-event") ?? "";
    if (event === "ping") return Response.json({ ok: true });
    const delivery = request.headers.get("x-github-delivery");
    if (!delivery) return Response.json({ error: "missing delivery id" }, { status: 400 });
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return Response.json({ error: "body is not JSON" }, { status: 400 });
    }
    if (!selectWebhook(event, payload, env.ACTION_WORKFLOW)) {
      console.log(JSON.stringify({ event, outcome: "ignored" }));
      return Response.json({ ok: true, ignored: event });
    }
    try {
      // Do not acknowledge until Convex has durably accepted the event. A timeout
      // remains a failed GitHub delivery, which the recovery cron can redeliver.
      const response = await fetch(env.CONVEX_WEBHOOK_URL, {
        method: "POST",
        body: raw,
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-event": event,
          "x-github-delivery": delivery,
        },
      });
      // Workers does not implement redirect: "error". Never send GitHub's
      // signed payload to a redirect target or report a redirect as acceptance.
      if (response.status >= 300 && response.status < 400) {
        throw new Error("webhook backend returned a redirect");
      }
      console.log(JSON.stringify({ event, outcome: "forwarded", status: response.status }));
      return response;
    } catch {
      console.error(JSON.stringify({ event, outcome: "upstream_unavailable" }));
      return Response.json({ error: "webhook backend is unavailable" }, { status: 503 });
    }
  },
};
