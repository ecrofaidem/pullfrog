# ecrofaidem/pullfrog

Fork of [pullfrog/pullfrog](https://github.com/pullfrog/pullfrog). The action at the repo root stays as close to upstream as possible so `git merge upstream/main` stays clean; everything we add lives beside it, and the few deliberate edits to the action tree are listed below.

- `server/` — Convex backend replacing the closed Pullfrog server (installation tokens, run-context with Codex subscription refresh, secret write-back, GitHub App webhook dispatcher). See `server/README.md`.
- `web/` — dashboard (TanStack Start on Cloudflare).

Consumers pin `uses: ecrofaidem/pullfrog@<sha>` with `API_URL` pointing at the Convex deployment and `PULLFROG_FORCE_LOCAL_CLI: "1"` in the step's `env:`. Without that flag the action bootstraps the published `pullfrog` npm package and ignores this fork's source.

Deliberate divergences from upstream in the action tree (expect a merge conflict here, keep ours):

- `utils/buildPullfrogFooter.ts` — the comment footer is just the workflow-run link and the model. Upstream's logo, X link, SHA-pin nudge and Fix-all links are dropped; the fix links pointed at a hosted `/trigger` endpoint this server does not have.

Upstream sync:

```
git fetch upstream && git merge upstream/main
```
