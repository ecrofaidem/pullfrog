import { internalAction } from "./_generated/server";
import { actionWorkflow } from "./actionVersion";
import {
  appJwt,
  createInstallationToken,
  findRepoInstallation,
  getPullRequest,
} from "./lib/github";
import { selectWebhook } from "./lib/webhookEvent";
import {
  RECOVERY_WINDOW_MS,
  parseDeliveries,
  retryableDeliveries,
  type Delivery,
} from "./lib/webhookRecovery";

/** GitHub does not automatically retry failed deliveries. This never retries a workflow_dispatch. */
export const redeliverFailed = internalAction({
  args: {},
  handler: async (): Promise<{
    inspected: number;
    retried: number;
    skipped: number;
    complete: boolean;
  }> => {
    const token = await appJwt();
    const request = async (path: string, method = "GET") => {
      const response = await fetch(`https://api.github.com${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "prfrog-webhook-recovery",
        },
      });
      if (!response.ok) throw new Error(`Webhook recovery: GitHub ${response.status}`);
      return response;
    };
    const now = Date.now();
    const deliveries: Delivery[] = [];
    let path: string | undefined = "/app/hook/deliveries?per_page=100";
    let complete = false;
    // Bound both the scan and retries. No full-payload journal or polling per review.
    for (let page = 0; path && page < 10; page++) {
      const response = await request(path);
      const batch = parseDeliveries(await response.text());
      deliveries.push(...batch);
      const link = /<([^>]+)>; rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
      if (!link || batch.some((d) => Date.parse(d.delivered_at) < now - RECOVERY_WINDOW_MS)) {
        complete = true;
        break;
      }
      const next = new URL(link);
      if (next.origin !== "https://api.github.com" || next.pathname !== "/app/hook/deliveries") {
        throw new Error("Unexpected webhook pagination link");
      }
      path = next.pathname + next.search;
    }
    let retried = 0;
    let skipped = 0;
    for (const delivery of retryableDeliveries(deliveries, now).slice(0, 20)) {
      const detail: { event: string; request: { payload: unknown } } = await (
        await request(`/app/hook/deliveries/${delivery.id}`)
      ).json();
      const selected = selectWebhook(detail.event, detail.request.payload, actionWorkflow());
      if (!selected) {
        skipped++;
        continue;
      }
      // Installation events are deltas: replaying an old removal after a newer
      // addition would disable a currently installed repo. Reconcile these from
      // GitHub's current membership instead of retrying the historical transition.
      if (selected.event === "installation" || selected.event === "installation_repositories") {
        console.warn(`Installation delivery ${delivery.id} needs membership reconciliation`);
        skipped++;
        continue;
      }
      // Automatic reviews describe a particular open PR head. Comment requests
      // are re-authorized by the dispatcher and can target issues or draft PRs.
      if (selected.event === "pull_request") {
        const p = selected.payload;
        const owner = p.repository.owner.login;
        const repo = p.repository.name;
        const installation = await findRepoInstallation(owner, repo);
        if (!installation) {
          skipped++;
          continue;
        }
        const auth = await createInstallationToken(installation.id, { repositories: [repo] });
        const number = p.pull_request.number;
        const current = await getPullRequest({ token: auth.token, owner, repo, number });
        // A delayed event must not review a closed/draft PR or an obsolete head.
        if (
          current.state !== "open" ||
          current.draft ||
          current.head.sha !== p.pull_request.head.sha
        ) {
          skipped++;
          continue;
        }
      }
      await request(`/app/hook/deliveries/${delivery.id}/attempts`, "POST");
      retried++;
    }
    if (!complete) console.warn("Webhook recovery scan reached its 1000-delivery limit");
    console.log(JSON.stringify({ inspected: deliveries.length, retried, skipped, complete }));
    return { inspected: deliveries.length, retried, skipped, complete };
  },
});
