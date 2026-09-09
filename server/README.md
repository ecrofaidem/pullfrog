# frogbot server

Convex backend that stands in for the closed Pullfrog server. The forked action at the repo root talks to it over the same HTTP contract Pullfrog's hosted service exposes, so the action tree stays byte-identical to upstream.

What it does:

- **Installation tokens.** `POST /api/github/installation-token` verifies the GitHub Actions OIDC token and mints an App installation token for the calling repo. This is why the action's pushes trigger downstream workflows.
- **Run context.** `GET /api/repo/:owner/:repo/run-context` returns the repo's settings, a per-run bearer, and the stored secrets. The Codex chain is refreshed under a lease so concurrent runs never race the rotation.
- **Write-back.** `PUT /api/runtime/secret` accepts the rotated Codex chain from the action's post step. `PATCH /api/workflow-run/:id` records model, tokens and artifact ids.
- **CLI.** `/api/cli/secrets` is what `npx pullfrog auth codex` talks to, unmodified, when `PULLFROG_API_URL` points here. `/api/cli/config` reads and patches a repo's settings with the same dotted keys the dashboard shows (`convex/configKeys.ts`), authenticated with the user's `gh auth token`:

  ```
  curl -H "Authorization: Bearer $(gh auth token)" "https://<site>/api/cli/config?owner=ecrofaidem&repo=monorepo"
  curl -X PATCH -H "Authorization: Bearer $(gh auth token)" -H "content-type: application/json" \
    -d '{"owner":"ecrofaidem","repo":"monorepo","set":{"review.on_push":true}}' https://<site>/api/cli/config
  ```
- **Dispatcher.** A Cloudflare Worker receives the App's webhooks, verifies their signatures, and rejects unrelated events before they reach Convex. Convex applies the same filter, atomically deduplicates and schedules compact events, then dispatches `pullfrog.yml`. Repository review policy and permission checks remain in `convex/dispatch.ts`.

## Layout

```
convex/
  http.ts            route table
  handlers/          one file per endpoint
  dispatch.ts        webhook → review policy → workflow_dispatch
  repos.ts           settings, installations, RepoSettings mapping
  secrets.ts         encrypted store + refresh lease
  runs.ts            run rows for the dashboard, stale-run sweep
  health.ts          the one HEAD sentence's data, shared by every view
  configKeys.ts      the settings contract (dashboard labels = CLI keys)
  crons.ts           sweep stale runs every 5 minutes
  actionVersion.ts   envelope version tracks the fork's package.json
  webhooks.ts        atomic delivery acceptance, seven-day delivery ID expiry
  webhookRecovery.ts bounded recovery of transient delivery failures
  auth.ts            Better Auth, GitHub sign-in, org gate
  lib/               jwt, oidc, crypto, github client, codex refresh
```

## Environment

Set with `npx convex env set NAME value` on the target deployment.

| Name | Value |
| --- | --- |
| `GITHUB_APP_ID` | the App's numeric id |
| `GITHUB_APP_PRIVATE_KEY` | the App's PEM (PKCS#1 as downloaded is fine) |
| `GITHUB_APP_SLUG` | `frogbot` |
| `GITHUB_WEBHOOK_SECRET` | the App's webhook secret |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `RUN_TOKEN_SECRET` | `openssl rand -base64 48` |
| `ACTION_REPO` | `ecrofaidem/pullfrog` |
| `ACTION_REF` | `main` |
| `ACTION_WORKFLOW` | `pullfrog.yml` |
| `DEFAULT_REVIEW_AUTHORS` | comma-separated GitHub logins seeded into new repos' allowlist |
| `ALLOWED_GITHUB_ORG` | `ecrofaidem` |
| `GITHUB_OAUTH_CLIENT_ID` | OAuth App for dashboard sign-in (needs `read:org`) |
| `GITHUB_OAUTH_CLIENT_SECRET` | its secret |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `SITE_URL` | the dashboard origin |

## GitHub App

Create it at `https://github.com/organizations/ecrofaidem/settings/apps/new`.

- Name `frogbot`. Webhook URL `https://<webhook-worker>/webhooks/github`, with the secret above. Deploy and configure the Worker before changing this URL.
- Repository permissions: actions **write**, checks **write**, contents **write**, issues **write**, pull requests **write**, workflows **write**, metadata **read**.
- Subscribe to events: installation, installation repositories, pull request, issue comment, workflow run.
- Install it on the org, selected repositories only.

The dashboard sign-in uses a separate OAuth App, because a GitHub App's user tokens cannot request the `read:org` scope the org gate needs. Callback URL: `<SITE_URL>/api/auth/callback/github`.

## Repo workflow

The consuming repo needs `.github/workflows/pullfrog.yml` (see the root README) with:

```yaml
uses: ecrofaidem/pullfrog@main
env:
  API_URL: https://<deployment>.convex.site
```

## Commands

```
pnpm dev        # local dev deployment, live push on save
pnpm deploy     # production
pnpm test       # Convex and webhook Worker regression tests
pnpm typecheck
```

Seed the Codex credential from a checkout of the consuming repo:

```
PULLFROG_API_URL=https://<deployment>.convex.site npx pullfrog auth codex
```

Re-run the same command to switch the credential to a different ChatGPT account.

## Deploy the webhook filter

Run these commands from `server/`. The dashboard and action continue to use the
Convex site URL; only the GitHub App's webhook URL changes.

1. Set `CONVEX_WEBHOOK_URL` and `ACTION_WORKFLOW` in `wrangler.jsonc` for the
   target deployment. Keep `ACTION_WORKFLOW` equal to the Convex environment
   value. Both receivers use the same event selector.
2. Run `pnpm test` and `pnpm typecheck`, then `pnpm deploy` to deploy the backend.
3. Run `pnpm deploy:webhook`. This deploys the separate `prfrog-webhooks` Worker.
4. Run `pnpm exec wrangler secret put GITHUB_WEBHOOK_SECRET` and enter the same
   signing secret used by GitHub and Convex. Do not put it in `wrangler.jsonc`.
5. Check the Worker's `/healthz` endpoint, then change the GitHub App's webhook
   URL to the Worker's `/webhooks/github` endpoint. Keep JSON payloads and TLS
   verification enabled.
6. Verify an unrelated workflow receives `200` without a Convex call, and a
   prfrog workflow receives `202` and updates its existing run. A duplicate
   delivery receives `200` without scheduling another event.

The Worker forwards accepted requests with their original signed bodies and
waits for Convex acceptance before acknowledging GitHub. Its sampled logs contain
event names, outcomes, and status codes, never payloads or credentials. Use Worker
request metrics and Convex's per-function usage breakdown to measure traffic.

For rollback, restore the App's webhook URL to the Convex site's
`/webhooks/github` endpoint. The backend still filters and compacts events, but
incoming HTTP calls count toward Convex usage again.

## Retention and delivery recovery

Completed scheduled records remain in Convex for seven days. This means old,
large payloads do not disappear immediately after deployment. Delivery IDs also
expire after seven days, in batches of 500; review history remains stored.

GitHub does not automatically retry failed deliveries. A five-minute recovery
cron scans up to 1,000 recent delivery attempts and retries transport or 5xx
failures at most twice within a 30-minute window. Each pass retries at most 20
events. It skips accepted deliveries, irrelevant events, closed/draft PRs, and
superseded PR heads. Failed installation changes require reconciliation against
GitHub's current membership; replaying an old removal could undo a newer addition.
Older failures and a scan-limit warning also require operator review.

Workflow-state reconciliation retries failures twice, after 5 and 30 seconds.
Existing run rows with an unknown attempt number are reconciled against GitHub
before an event can update them. Review dispatch itself is not automatically
retried: an ambiguous dispatch response must not launch duplicate reviews.

Monitor scheduled action failures separately. After a longer outage, inspect
missed review requests before redelivering them rather than replaying an entire
webhook backlog.
