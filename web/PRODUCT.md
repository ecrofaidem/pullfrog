# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TanStack Start (React 19) on Cloudflare Workers, Convex for data and auth via the Better Auth component. Decided by the user before design work; not delegated.

## Users

Engineers at ecrofaidem, a handful of people, with Tristan as the only reviewed author during the trial. They open the dashboard a few times a day, often from a phone between other work, to check whether a review ran on a PR, adjust who gets reviewed, and confirm the Codex subscription credential is still healthy. Nobody lives in this tool; visits are short and purposeful.

## Product Purpose

frogbot is a self-hosted GitHub bot built on the forked Pullfrog action. It reviews pull requests with GPT Sol on a ChatGPT Codex subscription instead of per-token API keys, replacing Bugbot and the Anthropic-keyed Claude workflows in the monorepo. The dashboard exists so the trial can be run without opening the Convex data browser: see runs, change policy, and know when the credential needs reseeding. Success is that a missing or failed review is noticed within minutes and the fix is one visible action.

## Positioning

The only Pullfrog-compatible control surface that runs against our own Convex server. The credential story is the differentiator a hosted product cannot copy: a ChatGPT subscription chain rotated under a lease, written back after every run, reseeded with one CLI command.

## Operating Context

- GitHub is the primary surface; reviews, check-runs and `@frogbot review` comments happen there. The dashboard is secondary and links out to the Actions run and the PR.
- One repo during the trial (`ecrofaidem/monorepo`), more later. Settings are per repo.
- Runs arrive via webhook, so the runs list changes while someone is looking at it.
- Credential reseeding happens in a terminal (`npx pullfrog auth codex`), not in the dashboard. The dashboard shows health and the command.
- Failed runs also surface in the monorepo's ClickUp notifier. The dashboard's health banner is the first place to look.

## Capabilities and Constraints

- Three views: runs (live list with status, PR link, model, tokens, link to the Actions log), settings (model, effort, review-author allowlist or all, comment handle, signature, setup script, push and shell tiers, timeout), credentials (per-secret health: last refresh, rejected state, reseed command). A health banner on every view.
- Sign-in with GitHub, restricted to org members. No public pages beyond sign-in.
- Data comes from Convex queries defined in `../server/convex`; the dashboard never sees secret values.
- Terminology: run, dispatch, review, incremental review, chain (the Codex refresh chain), reseed, allowlist, handle, signature.
- Undecided: multi-repo navigation once more repos are enabled; whether a manual prompt box is added in week two.

## Brand Commitments

- Name: frogbot. Comment handle `@frogbot`. Reviews sign off with 🐸, configurable per repo.
- The frog is a sign-off, not a brand system. No mascot, no frog illustration, no green-for-its-own-sake.
- Voice: terse, technical, plain language. Matches the team's register.

## Evidence on Hand

- Real data shape: `server/convex/schema.ts` (runs, repos, secrets, installations). Demonstration rows during the trial are real runs; nothing needs inventing.
- No logo asset exists. Absent: screenshots, testimonials, metrics. Do not fabricate any.

## Product Principles

- A missing review must be obvious before anything else on the page is.
- Every state the server can be in has a visible, named representation: dispatched, queued, in progress, failed, cancelled, chain rejected, lease held.
- Settings changes are rare and consequential; make the current value unmistakable and the change deliberate.
- Link out rather than duplicate GitHub: the PR and the Actions log are one click away, never re-rendered here.
- Phone-readable without a phone layout of its own: the same structure collapses cleanly.

## Accessibility & Inclusion

Keyboard-operable settings forms; status conveyed by text and shape, never colour alone; both light and dark colour schemes respected.
