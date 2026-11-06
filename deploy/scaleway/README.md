# PR Frog on Scaleway

Run PR Frog in an Ubuntu VM on the shared Elastic Metal host. GitHub Actions
continues to execute reviews. Docker Compose runs the Convex backend, the Node
frontend, and a proxy for public callbacks.

## Network

The VM joins the company tailnet as `prfrog`. All Docker ports bind to loopback.
Tailscale handles HTTPS certificates and access to these ports:

| URL | Access | Service |
| --- | --- | --- |
| `https://prfrog.tail17ee78.ts.net` | Tailnet | PR Frog dashboard |
| `https://prfrog.tail17ee78.ts.net:8444` | Tailnet | Convex client API and WebSockets |
| `https://prfrog.tail17ee78.ts.net:8445` | Tailnet | Auth and HTTP actions |
| `https://prfrog.tail17ee78.ts.net:8443` | Public Funnel | GitHub webhook and Actions callbacks |

`Caddyfile` permits only the public methods and paths used by GitHub and Actions.
The backend verifies webhook signatures, Actions OIDC tokens, and run tokens.
The proxy does not publish dashboard, CLI, or Convex administrative routes.
Funnel is public access, not tailnet authentication. Keep it on its own port.

The optional `admin` Compose profile starts the Convex management dashboard on
loopback port 6791. Access it through an SSH tunnel when needed.

## Create the host and VM

Use the Services project and a monthly EM-B130E-NVMe offer. Select Ubuntu 26.04
and the default RAID 1 partition layout. Render `host.cloud-init.yaml` with the
administrator's public SSH keys before passing it to Scaleway. Set deletion
protection and confirm it after creation.

The template marks the EM-B130E's unused second NIC as optional so DHCP does not
delay boot. It sends RAID events to the system journal. Check the interface name
if you use a different server model.

After cloud-init completes, copy `create-vm.sh` and an authorized public-key file
to the host. Run:

```sh
sudo bash create-vm.sh authorized_keys
sudo virsh domifaddr prfrog
```

The VM has 4 vCPUs, 8 GiB RAM, and a 150 GiB virtual disk. It starts automatically
with the host. The script refuses to replace an existing VM or disk directory.
Complete `tailscale up` separately on the host and VM using the company account.
Each machine needs its own Tailscale identity.

## Deploy the candidate

Clone this repository to `/opt/prfrog` in the VM. Install the Node version from
`.node-version` and pnpm, then install the root, server, and web dependencies
with their frozen lockfiles.

1. Copy `.env.example` to `.env` in this directory and restrict it to mode 0600.
2. Generate `INSTANCE_SECRET` with `openssl rand -hex 32` and save it in `.env`.
3. Confirm the VM's actual tailnet name and update the three URLs.
4. Start the backend:

   ```sh
   docker compose up -d backend
   ```

5. Generate an admin key with `docker compose exec backend ./generate_admin_key.sh`.
   Save it privately with `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210` in
   `server/.env.self-hosted`, using the variable `CONVEX_SELF_HOSTED_ADMIN_KEY`.
   Set that file's permissions to 0600. Do not copy a Convex Cloud deploy key.
6. From `server`, deploy with an explicit environment file:

   ```sh
   pnpm exec -- convex deploy --env-file .env.self-hosted
   ```

7. Set backend application variables using `convex env set` with that same
   environment file. Use a separate GitHub App and OAuth application for the
   candidate. The required variables are documented in `server/README.md`.
   Set `ACTION_WORKFLOW=pullfrog-scaleway.yml` and generate new encryption,
   run-token, webhook, and Better Auth secrets.
   Set `CONVEX_INTERNAL_SITE_URL=http://127.0.0.1:3211` in the backend's
   application environment. JWT verification then fetches its signing keys from
   the local backend; the issuer remains the private HTTPS site URL.
8. Run `docker compose up -d --build` in this directory.
9. Run `bash configure-tailscale.sh`. Complete the Funnel approval if prompted.

The frontend's public URLs are embedded at build time. Rebuild it when those
URLs change. Server-side auth calls use the internal Docker network.
`pnpm --dir web build` retains the Cloudflare build; `build:node` selects Node.

## Parallel trial

Install the candidate GitHub App on a disposable test repository first. Its
webhook URL is the Funnel address with `/webhooks/github` appended. The separate
OAuth application's callback is the private dashboard URL with
`/api/auth/callback/github` appended.

Add `pullfrog-scaleway.yml` to the test repository. Configure its `API_URL` to
use the Funnel address. Keep the existing production workflow and API variable.
Use an independent Codex login for the candidate. Copying a production refresh
token would make both deployments refresh the same credential.

Start with a fresh database and review-only permissions. Disable documentation
updates and automatic fixes during the trial. Test a PR with a known defect,
then compare reviews on selected real PRs. Check webhook delivery, job dispatch,
credential refresh, comments, status checks, and dashboard updates before
changing the production installation.

## Backups

`backup.sh` stops the backend, archives its complete data volume, and restarts
it before uploading the archive. The encrypted restic snapshot also contains
the instance configuration and source revision. Retention is seven daily,
four weekly, and six monthly snapshots. The script checks repository integrity
after each backup.

Configure a dedicated Scaleway Object Storage bucket and restricted credentials
in `/etc/prfrog/backup.env`, readable only by root:

```sh
RESTIC_REPOSITORY=s3:https://s3.fr-par.scw.cloud/BUCKET/prfrog
RESTIC_PASSWORD_FILE=/etc/prfrog/restic-password
AWS_ACCESS_KEY_ID=REPLACE
AWS_SECRET_ACCESS_KEY=REPLACE
AWS_DEFAULT_REGION=fr-par
```

Keep a recoverable copy of the restic password outside this host. Initialize the
repository once with `restic init`, using those environment variables. Install
the service and timer files in `/etc/systemd/system`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now prfrog-backup.timer
sudo systemctl start prfrog-backup.service
```

Check the first backup and perform a restore before relying on the timer. Monitor
failed backup units and the age of the latest successful snapshot.

### Restore

Restore the snapshot into an isolated directory with `restic restore`. Use the
saved source revision and Compose file. Restore `instance.env` as `.env`, keeping
the original instance secret. Stop the target backend and extract `data.tar`
into its empty data volume, preserving numeric ownership. Start the backend
with the saved image digest.

For a restore test, block outbound network access so restored scheduled jobs
cannot contact GitHub or refresh credentials. Verify the health route, database
records, and stored files. During a real recovery, stop the previous deployment
before enabling network access on the restored one.

## Verification

For a disposable local stack, use a separate Compose project and ports 13210,
13211, 13000, and 18080. Deploy the backend functions and set its webhook secret
to `local-integration-test-only`. Run `python3 deploy/scaleway/test-stack.py`.
It checks the rendered sign-in page, public route restrictions, rejected unsigned
requests, and an accepted signed webhook ping.

Also run root, server, and web type checks, the server tests, root unit tests,
and both frontend builds. Verify backup restoration and a VM reboot on the
Scaleway deployment. A local test does not validate the live GitHub App or OAuth
configuration.

References: [Convex self-hosting](https://github.com/get-convex/convex-backend/tree/main/self-hosted),
[TanStack Node hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting),
[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel).
