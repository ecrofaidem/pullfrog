# Contributing to Pullfrog

Thanks for your interest in contributing!

This repo (`pullfrog/pullfrog`) is the open-source GitHub Action that powers Pullfrog. The rest of the product (web app, API) is proprietary and lives elsewhere, so contributions here focus on the action runtime.

## Prerequisites

- Node.js (see `.node-version` for the exact version)
- The canonical toolchain is [`nub`](https://nubjs.com) (`nub install`, `nub run <script>`); [`pnpm`](https://pnpm.io/) also works against the same `pnpm-lock.yaml`.

## Setup

```bash
git clone https://github.com/<your-username>/pullfrog.git
cd pullfrog
nub install   # or: pnpm install
```

## Running tests

```bash
nub run typecheck   # or: pnpm typecheck
nub run test        # or: pnpm test
```

Run `typecheck` and the unit tests before opening a PR. Both run in CI for every PR and support standalone checkouts. When this action is checked out inside the private monorepo, the unit tests also compare its workflow with the parent workflow.

For this fork's Codex account pool, run the root tests plus `pnpm --dir server
test` and `pnpm --dir server typecheck`. The backend suite uses an in-memory
Convex database and mocked GitHub/OAuth services. It covers selection, token
rotation, finalization, recovery, management permissions, and compatibility.
The runtime suite covers startup refusal and temporary auth files passed to the
post hook. These tests do not use live ChatGPT accounts. For dashboard changes,
also run `pnpm --dir web typecheck` and `pnpm --dir web build`.

Production canaries, deployment, account enrollment, and pool activation are
separate operator steps in [the server runbook](server/README.md#activate-or-roll-back-a-pool).

The separate agent integration matrix needs Nub, provider credentials, and access to the test repositories. It runs automatically in `pullfrog/pullfrog`. Forks skip it by default. To enable it in a configured fork, provision the credentials referenced in `.github/workflows/test.yml`, ensure the tests can access their fixture repositories, and set the GitHub Actions repository variable `PULLFROG_AGENT_TESTS` to `true`. A skipped matrix does not verify agent behavior.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `test:`.

Example: `feat(action): add prompt_file input`

## Opening a PR

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run `nub run typecheck` (and `nub run test` where you have the required credentials)
5. Push and open a PR against `main`

## Questions?

Open an issue or reach out at [team@pullfrog.com](mailto:team@pullfrog.com).
