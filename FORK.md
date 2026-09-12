# ecrofaidem/pullfrog

Fork of [pullfrog/pullfrog](https://github.com/pullfrog/pullfrog). The action at the repo root stays as close to upstream as possible so `git merge upstream/main` stays clean; everything we add lives beside it, and the few deliberate edits to the action tree are listed below.

- `server/` — Convex backend replacing the closed Pullfrog server (installation tokens, run-context with Codex subscription refresh, secret write-back, GitHub App webhook dispatcher). See `server/README.md`.
- `web/` — dashboard (TanStack Start on Cloudflare).

Consumers pin `uses: ecrofaidem/pullfrog@<sha>` with `API_URL` pointing at the Convex deployment and `PULLFROG_FORCE_LOCAL_CLI: "1"` in the step's `env:`. Without that flag the action bootstraps the published `pullfrog` npm package and ignores this fork's source.

Deliberate divergences from upstream in the action tree (expect a merge conflict here, keep ours):

- `utils/codexPool*.ts`, `utils/runContext.ts`, `main.ts`, `agents/codex.ts`,
  `utils/oauthWriteback.ts`, and the close callback in `utils/subprocess.ts` —
  opt-in selection from named Codex accounts, exclusive native-process
  ownership, and fenced final auth write-back. An enabled pool requires
  `PULLFROG_CODEX_POOL_REQUIRED: "1"` and native Codex; startup failures cannot
  fall back to API billing. Pool-disabled runs retain the legacy path. See
  [account setup and activation](server/README.md#named-codex-accounts).
- `utils/buildPullfrogFooter.ts` — the comment footer is the workflow-run link, the model, and the subscription's remaining limit. Upstream's logo, X link, SHA-pin nudge and Fix-all links are dropped; the fix links pointed at a hosted `/trigger` endpoint this server does not have.
- `utils/runStats.ts` (new), one `recordToolUse()` line in `main.ts`, `recordTokens()`/`recordSubagentFinish()` lines where `agents/opencode.ts` and `agents/codex.ts` accumulate usage, and a `toolState`/`review` argument at the four footer call sites — time, tokens, subagents, tool calls, diff coverage and inline-comment counts in the footer, with the breakdown in a collapsed block.
- `utils/codexUsage.ts` (new) and one `primeCodexUsage()` line in `main.ts` — reads `GET https://chatgpt.com/backend-api/wham/usage` with the run's chain, the same call the Codex CLI's status screen makes.
- `skills/write-good-docs/`, `skills/simple-english/`, `utils/skills.ts`, `utils/instructions.ts`, and `agents/codex.ts` — all three harnesses load the complete writing skills before drafting review comments or final reports. The installer copies references and scripts into the agent's temporary home. Codex reads the skill files; OpenCode and Claude use their native skill tools. Source versions and SHA-256 hashes are recorded in `skills/report-skills.json`; supplied skill files remain unchanged. The added `write-good-docs/ATTRIBUTION.md` documents the missing source notice. To update a skill, replace its complete directory from the source, update its manifest entry, and run `pnpm exec vitest run utils/skills.test.ts` plus the report-writing agent smoke test.
- `utils/reviewConventions.ts`, `modes.ts`, and `agents/reviewer.ts` — full reviews, incremental reviews, and review specialists read applicable repository guidance before assessing conventions. Findings cite written requirements, account for exceptions, and use severity based on consequences. UI changes also require an internal map of existing composed components and inspected callers, including inline UI. Findings must identify a written rule, a suitable existing component or compatible extension, and a concrete consequence. Valid feature wrappers and documented exceptions remain permitted. The agent records consulted guidance in its internal run logs. This is prompt guidance, not a machine-enforced read-coverage gate or persistent learning.

## Repository conventions evaluation

The opt-in synthetic evaluation covers full and incremental review scopes,
written-rule violations, duplicated KPI tiles, explanatory table titles, valid
UI compositions, permitted exceptions, unrelated existing violations,
and unavailable or conflicting guidance. It uses disposable repositories and
the normal authenticated agent test runner in neutral Task mode; it does not
post review comments. It evaluates the shared conventions prompt, not the
complete production review workflow. Wiring tests verify that both review modes
include the pass for Codex, Claude, and OpenCode. Codex runs it in the main
reviewer; its harness disables specialist fan-out. Runs that load review modes, skills, or
specialists fail the isolation checks because those add instructions to the
comparison.

```bash
node test/run.ts repo-conventions-full repo-conventions-incremental codex
REPO_CONVENTIONS_BASELINE=1 node test/run.ts repo-conventions-full repo-conventions-incremental codex
```

The baseline uses the earlier generic guidance-discovery instruction. Compare
the `caught:*` checks (misses), `no_false_positives_or_duplicates`, and evidence
checks separately. Exact quotations establish citation evidence; inspect the
transcript to confirm actual file reads. A single passing run does not establish
a general improvement in review quality. The fixture tests run without model
credentials:

```bash
pnpm exec vitest run test/repoConventionsFixture.test.ts
```

## Upstream sync

Integrate upstream changes with:

```
git fetch upstream && git merge upstream/main
```
