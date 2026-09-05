# ecrofaidem/pullfrog

Fork of [pullfrog/pullfrog](https://github.com/pullfrog/pullfrog). The action at the repo root stays as close to upstream as possible so `git merge upstream/main` stays clean; everything we add lives beside it, and the few deliberate edits to the action tree are listed below.

- `server/` — Convex backend replacing the closed Pullfrog server (installation tokens, run-context with Codex subscription refresh, secret write-back, GitHub App webhook dispatcher). See `server/README.md`.
- `web/` — dashboard (TanStack Start on Cloudflare).

Consumers pin `uses: ecrofaidem/pullfrog@<sha>` with `API_URL` pointing at the Convex deployment and `PULLFROG_FORCE_LOCAL_CLI: "1"` in the step's `env:`. Without that flag the action bootstraps the published `pullfrog` npm package and ignores this fork's source.

Deliberate divergences from upstream in the action tree (expect a merge conflict here, keep ours):

- `utils/buildPullfrogFooter.ts` — the comment footer is the workflow-run link, the model, and the subscription's remaining limit. Upstream's logo, X link, SHA-pin nudge and Fix-all links are dropped; the fix links pointed at a hosted `/trigger` endpoint this server does not have.
- `utils/runStats.ts` (new), one `recordToolUse()` line in `main.ts`, `recordTokens()`/`recordSubagentFinish()` lines where `agents/opencode.ts` and `agents/codex.ts` accumulate usage, and a `toolState`/`review` argument at the four footer call sites — time, tokens, subagents, tool calls, diff coverage and inline-comment counts in the footer, with the breakdown in a collapsed block.
- `utils/codexUsage.ts` (new) and one `primeCodexUsage()` line in `main.ts` — reads `GET https://chatgpt.com/backend-api/wham/usage` with the run's chain, the same call the Codex CLI's status screen makes.
- `package.json` and `pnpm-lock.yaml` — pin the Codex CLI and SDK to 0.153.4. The configured `gpt-6-astra` model rejects the upstream 0.147.0 CLI before a report turn starts.
- `skills/write-good-docs/`, `skills/simple-english/`, `utils/skills.ts`, `utils/instructions.ts`, and `agents/codex.ts` — all three harnesses load the complete writing skills before drafting review comments or final reports. The installer copies references and scripts into the agent's temporary home. Codex reads the skill files; OpenCode and Claude use their native skill tools. Source versions and SHA-256 hashes are recorded in `skills/report-skills.json`; supplied skill files remain unchanged. The added `write-good-docs/ATTRIBUTION.md` documents the missing source notice. To update a skill, replace its complete directory from the source, update its manifest entry, and run `pnpm exec vitest run utils/skills.test.ts` plus the report-writing agent smoke test.

Upstream sync:

```
git fetch upstream && git merge upstream/main
```
