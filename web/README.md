# frogbot dashboard

Runs, settings and credentials for the Convex server in `../server`. TanStack Start on Cloudflare Workers; data and auth from Convex (Better Auth, GitHub sign-in, org members only).

Views:

- **Runs** — the rail. HEAD carries the health sentence (Codex chain state, last run); every run is a node with its PR, kind, state glyph, triggerer, elapsed, model, tokens and a link to the Actions log. Incremental reviews draw a lane back to the review they extend.
- **Settings** — the repo's config as a keyed sheet: review allowlist, re-review on push, handle, signature, model, effort, timeout, push and shell tiers, setup scripts.
- **Credentials** — Codex chain health and the reseed command; other stored secrets by name only.

Design decisions are recorded in `DESIGN.md`; product truth in `PRODUCT.md`.

## Run locally

```
cp .env.example .env.local     # point at the Convex deployment
pnpm install
pnpm dev                       # http://localhost:3000
```

Against the anonymous local Convex backend (`cd ../server && CONVEX_AGENT_MODE=anonymous npx convex dev`) you can skip GitHub sign-in by setting `VITE_DEV_BYPASS_AUTH=1` here and `DASHBOARD_DEV_BYPASS=1` on that deployment. Both must be set; production never sets either.

## Deploy

```
pnpm build
pnpm deploy                    # wrangler deploy
```

Set `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` and `VITE_SITE_URL` at build time. The GitHub OAuth App's callback URL is `<VITE_SITE_URL>/api/auth/callback/github`.

## Screenshots

`pnpm capture` renders every view at desktop and phone widths into `.impeccable/review/` with the Playwright Chromium already on the machine.
