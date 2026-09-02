# ecrofaidem/pullfrog

Fork of [pullfrog/pullfrog](https://github.com/pullfrog/pullfrog). The action at the repo root is kept byte-identical to upstream so `git merge upstream/main` stays clean; everything we add lives beside it.

- `server/` — Convex backend replacing the closed Pullfrog server (installation tokens, run-context with Codex subscription refresh, secret write-back, GitHub App webhook dispatcher). See `server/README.md`.
- `web/` — dashboard (TanStack Start on Cloudflare).

Consumers use `uses: ecrofaidem/pullfrog@main` with `API_URL` pointing at the Convex deployment.

Upstream sync:

```
git fetch upstream && git merge upstream/main
```
