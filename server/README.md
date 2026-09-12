# frogbot server

Convex backend for the forked Pullfrog action and its internal dashboard. It
implements the action's HTTP endpoints and the named Codex account extension.

What it does:

- **Installation tokens.** `POST /api/github/installation-token` verifies the GitHub Actions OIDC token and mints an App installation token for the calling repo. This is why the action's pushes trigger downstream workflows.
- **Run context.** `GET /api/repo/:owner/:repo/run-context` returns settings and secrets. An enabled Codex pool reserves one account for the whole native process; the legacy single-secret path uses its existing refresh lease.
- **Write-back.** `POST /api/runtime/codex-pool` commits the selected account's final auth and releases its assignment. `PUT /api/runtime/secret` handles legacy secrets. `PATCH /api/workflow-run/:id` records model, tokens, and artifact IDs.
- **CLI.** `/api/cli/secrets` is what `npx pullfrog auth codex` talks to, unmodified, when `PULLFROG_API_URL` points here. `/api/cli/config` reads and patches a repo's settings with the same dotted keys the dashboard shows (`convex/configKeys.ts`), authenticated with the user's `gh auth token`:

  ```
  curl -H "Authorization: Bearer $(gh auth token)" "https://<site>/api/cli/config?owner=ecrofaidem&repo=monorepo"
  curl -X PATCH -H "Authorization: Bearer $(gh auth token)" -H "content-type: application/json" \
    -d '{"owner":"ecrofaidem","repo":"monorepo","set":{"review.on_push":true}}' https://<site>/api/cli/config
  ```
- **Dispatcher.** A Cloudflare Worker receives the App's webhooks, verifies their signatures, and rejects unrelated events before they reach Convex. Convex applies the same filter, atomically deduplicates and schedules compact events, then dispatches `pullfrog.yml`. Repository review policy and permission checks remain in `convex/dispatch.ts`.

## Comment requests

Mention the repository's configured handle in a new issue or PR conversation
comment, followed by a request. For example, `@prfrog please fix the docs for
this` asks the agent to make the requested changes. You must have write,
maintain, or admin access to the repository. Bot comments, edited comments,
bare mentions, and inline PR review comments do not trigger runs.

`@prfrog review` on a PR keeps the explicit review behavior and skips drafts.
Other requests can run on draft PRs and ordinary issues, regardless of the
automatic review author allowlist. For changes requested on a closed PR, the
agent is instructed to open a follow-up PR from the default branch. Repository
shell and push permissions still apply; restricted push permits feature
branches and blocks direct pushes to the default branch.

General requests use the existing action's modes and appear as `task` runs.
Deploy both the Convex backend and webhook Worker to enable them. The existing
`issue_comment` App subscription and consumer action pin support these requests.

## Layout

```
convex/
  http.ts            route table
  handlers/          one file per endpoint
  dispatch.ts        webhook → request policy → workflow_dispatch
  repos.ts           settings, installations, RepoSettings mapping
  secrets.ts         encrypted store + refresh lease
  codexAccounts.ts   encrypted named accounts and ordered repository pools
  codexAssignments.ts exclusive run ownership, finalization, terminal recovery
  codexQuota.ts      versioned weekly usage observations; idle reads only
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
uses: ecrofaidem/pullfrog@<full-compatible-commit-sha>
env:
  API_URL: https://<deployment>.convex.site
  PULLFROG_FORCE_LOCAL_CLI: "1"
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

## Named Codex accounts

A repository can use an ordered pool of dedicated ChatGPT accounts. A run takes
the first enabled, authenticated, idle account with fresh weekly usage below
100%. The provider must identify a seven-day window; missing or unavailable
evidence stops startup. Display rounding does not decide eligibility.

Each account has at most one native Codex process across its repository
memberships. Two accounts therefore support at most two concurrent runs. A
running review keeps its account until completion; it never switches accounts
or replays work when a limit is reached. Busy, exhausted, authentication,
configuration, and unknown-usage failures stop before the agent starts.

Build the compatible fork with `pnpm install --frozen-lockfile` and `pnpm build`.
The published npm CLI does not necessarily include these commands. From the
consuming repository, use that build:

```bash
export PULLFROG_API_URL="https://<deployment>.convex.site"
PULLFROG_CLI=/absolute/path/to/pullfrog/dist/cli.mjs
node "$PULLFROG_CLI" auth codex enroll Primary
node "$PULLFROG_CLI" auth codex enroll Secondary
node "$PULLFROG_CLI" auth codex list
node "$PULLFROG_CLI" auth codex pool <primary-id> <secondary-id>
```

Sign in to two distinct accounts. Enrollment uses an isolated Codex home; do not
share the resulting refresh chain with a desktop CLI or another service. Pool
configuration preserves its enabled state and starts disabled. Repository scope
is the default. `--scope account` shares an account across explicitly configured
repositories and requires owner administration; granting that account to a pool
also requires owner administration. Repository accounts require push access.

Use `auth codex disable <id>` to stop new assignments and `auth codex enable <id>`
to permit them. A disabled account can still have a run finishing. Use
`auth codex replace <id>` to sign in again to the same account. Replacement
preserves occupancy until the old run stops. Add `--scope account` when managing
an owner-scoped account. The private **Credentials** page shows account labels,
pool positions, usage, and occupancy; public run output uses neutral aliases.

## Activate or roll back a pool

Activation is an operator action separate from merging the implementation and
consumer pin. Use this order:

1. Deploy the compatible Convex backend with pools disabled. Deploy the matching
   dashboard, then pin the compatible action with
   `PULLFROG_FORCE_LOCAL_CLI: "1"`. Verify ordinary legacy runs still work.
2. Pause dispatch and drain every workflow using either account, including other
   repositories and desktop clients. Enroll the two dedicated accounts and set
   their order. Confirm native Codex is selected and remove externally supplied
   `CODEX_AUTH_JSON`, `CODEX_API_KEY`, and `OPENAI_API_KEY` credentials.
3. While dispatch remains paused, run
   `auth codex pool <primary-id> <secondary-id> --enable` and set
   `PULLFROG_CODEX_POOL_REQUIRED: "1"` on the action step. Both sides must agree;
   an enabled pool rejects older clients and a required-pool client refuses a
   disabled or incompatible backend.
4. Run a controlled canary. Verify the selected alias, finalization receipt,
   cleared occupancy, and reuse of the updated chain on the next run. Verify
   secondary selection with simulated exhausted usage in tests, not by burning
   the primary's allowance. Resume dispatch after these checks pass.

The post hook reads final auth only after the native child closes. If cleanup is
lost, the existing five-minute cron checks GitHub's exact workflow run attempt.
Only a completed attempt permits occupancy recovery. Unknown final tokens
quarantine the account until reenrollment; elapsed time alone never makes it
available. Inspect **Credentials** and the failed run before retrying.

For rollback, pause and drain all affected runs first. Restore a current legacy
login with `auth codex` using the compatible CLI, disable the pool with
`auth codex pool <primary-id> <secondary-id> --disable`, and remove the required
flag. Verify one legacy run before resuming dispatch. Never restore a saved old
auth blob: its refresh token may have been consumed. Keep the finalization
endpoint deployed until every old assignment is terminal.

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
events. It skips accepted deliveries, irrelevant events, and automatic reviews
of closed/draft PRs or superseded PR heads. Comment requests pass through the
dispatcher's current repository and commenter permission checks. Failed
installation changes require reconciliation against
GitHub's current membership; replaying an old removal could undo a newer addition.
Older failures and a scan-limit warning also require operator review.

Workflow-state reconciliation retries failures twice, after 5 and 30 seconds.
Existing run rows with an unknown attempt number are reconciled against GitHub
before an event can update them. Review dispatch itself is not automatically
retried: an ambiguous dispatch response must not launch duplicate reviews.

Monitor scheduled action failures separately. After a longer outage, inspect
missed review requests before redelivering them rather than replaying an entire
webhook backlog.
