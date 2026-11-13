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
- `mcp/checkout.ts` — checkout returns `unifiedDiffPath`, a complete unified patch generated from the captured base/head commits, alongside the numbered `diffPath` display. Patch parsers use the raw artifact, including large changes omitted by GitHub's per-file patches. Checkout refuses a revision change during the file fetch so artifacts and review anchors describe the same revision.
- `utils/buildPullfrogFooter.ts` — the comment footer is the workflow-run link, the model, and the subscription's remaining limit. Upstream's logo, X link, SHA-pin nudge and Fix-all links are dropped; the fix links pointed at a hosted `/trigger` endpoint this server does not have.
- `utils/runStats.ts` (new), one `recordToolUse()` line in `main.ts`, `recordTokens()`/`recordSubagentFinish()` lines where `agents/opencode.ts` and `agents/codex.ts` accumulate usage, a `setSubagentReader()` call in `agents/codex.ts` for subagents read from rollouts (`utils/codexRollouts.ts`, new), and a `toolState`/`review` argument at the four footer call sites — time, tokens, subagents, tool calls, diff coverage and inline-comment counts in the footer, with the breakdown in a collapsed block.
- `utils/patchWorkflowRunFields.ts`, `toolState.ts`, `agents/codex.ts`, and the end-of-run PATCH in `main.ts` — a subscription Codex run also reports `codexSpeed` (the applied tier), `codexSubagents` (review subagents spawned, each counted once) and `quotaEndPercent` (the account's weekly limit used, as last seen) to `server/convex/runs.ts`.
- `utils/codexUsage.ts` (new) and one `primeCodexUsage()` line in `main.ts` — reads `GET https://chatgpt.com/backend-api/wham/usage` with the run's chain, the same call the Codex CLI's status screen makes. Once a Codex session reports a newer weekly figure in its rollouts, the footer shows that one.
- `skills/write-good-docs/`, `skills/simple-english/`, `utils/skills.ts`, `utils/instructions.ts`, and `agents/codex.ts` — all three harnesses load the complete writing skills before drafting review comments or final reports. The installer copies references and scripts into the agent's temporary home. Codex reads the skill files; OpenCode and Claude use their native skill tools. Source versions and SHA-256 hashes are recorded in `skills/report-skills.json`; supplied skill files remain unchanged. The added `write-good-docs/ATTRIBUTION.md` documents the missing source notice. To update a skill, replace its complete directory from the source, update its manifest entry, and run `pnpm exec vitest run utils/skills.test.ts` plus the report-writing agent smoke test.
- `utils/reviewConventions.ts`, `modes.ts`, and `agents/reviewer.ts` — full reviews, incremental reviews, and review specialists read applicable repository guidance before assessing conventions. Findings cite written requirements, account for exceptions, and use severity based on consequences. UI changes also require an internal map of existing composed components and inspected callers, including inline UI. Findings must identify a written rule, a suitable existing component or compatible extension, and a concrete consequence. Valid feature wrappers and documented exceptions remain permitted. The agent records consulted guidance in its internal run logs. This is prompt guidance, not a machine-enforced read-coverage gate or persistent learning.

- `modes.ts` (IncrementalReview) and the incremental-scope bullet in `utils/reviewConventions.ts` — a re-review on push reports critical or must-address findings anywhere in the PR's changed lines, not only in the latest push. A finding on code from an earlier commit is reported only when no prior review raised it, and its comment opens with `Missed in an earlier review:`. Minor findings on lines a prior review already covered stay dropped. Resolved threads count for deduplication. Upstream scopes findings to the lines the latest push changed.

- `utils/reviewResume.ts`, `utils/reviewCoverage.ts` and `mcp/reviewCheckpoint.ts`
  — every push re-reads the whole PR. A verified complete review of the
  previous head no longer lets the next run skip unchanged sections; it sets
  `priorReviewComplete: true`, so earlier-commit findings follow the re-review
  rules above instead of being reported at any severity. One pass over a diff
  misses bugs that a fresh full pass finds. Upstream reuses verified prior
  coverage and reads only the delta.

- `commands/auth.ts` — `pullfrog auth codex` keeps the fork's named-account and pool commands. Upstream 0.1.8x rewrote this command around its hosted subscription API (`/api/.../credentials`), which this server does not implement, so the merge keeps ours wholesale.
- `utils/runContext.ts`, `utils/runContextData.ts`, and `main.ts` — the fork's Codex account pool (`utils/codexPool*.ts`) sits beside upstream's credential pool (`utils/credentialPool.ts`). Upstream's pool only acts when the server sends `credentialAccess`, which this server never does, so it stays inert. A pooled Codex run skips OpenCode model discovery, the proxy decision, and upstream's credential checks.
- `mcp/readFile.ts`, `utils/reviewCoverage.ts`, and `mcp/shell.ts` — fork-only callers of `runSandboxed` pass `seal: true`; `captureOutput` keeps the fork's object result with recovery hints.
- `models.ts` — `gpt-6-sol` and `gpt-6.1-sol` are explicit generation pins. The `gpt-sol` alias follows upstream, which resolves it to GPT-6.1 Sol since 0.1.9x.

Last upstream sync: 0.1.98 (`bb65913`, 2026-10-13).

## Codex speed

The `codex.speed` repository setting (`standard`, `fast` or `ultrafast`) is the
fastest service tier a native Codex PR review may use. Set it on the dashboard's
settings page or through `/api/cli/config`. Other harnesses ignore it.

`codex.speed.fallback_below` (default 10) caps Ultrafast at Fast when the run's
ChatGPT login has less than that percentage of its weekly limit left. A usage
read that fails also caps it, and 0 turns the cap off. The action reads the
limit once, at the start of a subscription run (`capForWeeklyLimit` in
`utils/codexSpeed.ts`). API-key runs skip the check.

Docs updates, general comment requests, and other non-review runs always use
Standard, including resumed turns. They ignore the legacy Fast flag. The
dispatcher sends `review` or `incremental_review` in the envelope's `type` to
identify reviews, including explicit review requests in PR comments.

For older dispatchers without a run type, only automatic PR review triggers
use the configured speed. Unclassified comment and manual runs use Standard.
Deploy the dispatcher change after updating consumers to the matching action
revision to enable the configured speed for explicit comment reviews.

The setting is a ceiling. Codex does not fail when the signed-in plan lacks a
tier: it drops the tier and runs at Standard. So before a subscription run the
harness reads the account's model catalog (`codex debug models`) and requests
the fastest listed tier at or below the setting. A pool account without
Ultrafast therefore runs at Fast. If the catalog cannot be read, the harness
requests at most Fast. API-key runs skip the catalog and request the setting.

The run log records the decision, for example
`codex speed: requested=ultrafast, applied=fast, advertised=fast`. This is the
requested tier, not a provider receipt. A warning follows if Codex still drops
the tier. `utils/codexSpeed.ts` holds the selection; `agents/codex.ts` applies
it to the first turn and resumed turns, and `main.ts` passes the setting in.

Until the setting is saved for a repository, the legacy
`PULLFROG_CODEX_FAST_MODE: "1"` workflow variable still requests Fast for reviews. A saved
setting always wins, including `standard`.

For included subscription usage, Fast consumes allowance at 2.5 times the
Standard rate and Ultrafast at 8 times. Ultrafast needs a Pro $500 or eligible
Enterprise or Edu plan. See
[OpenAI's speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed)
for availability and current rates.

## Codex reviews

Native Codex Review and IncrementalReview run baseline correctness, conventions,
documentation, and verification passes, plus applicable lenses for control,
propagation, data, frontend state, executable procedures, and lifecycle recovery.
Other harnesses retain their specialist dispatch flow. Repository review skills
supply checks, but their dispatch instructions do not apply. Reviews do not edit
the PR or wait for clarification: unavailable evidence produces an explicit
limitation. Focused tests resolve concrete uncertainty; broader or repeated
checks need a change, failure, or unresolved concern.

### Review subagents

A review run enables Codex `multi_agent_v2`. Runs of any other type keep
subagents off. The lead decides after its plan whether to delegate.

Two repository settings set the limits:

| Setting | Default | Effect |
| --- | --- | --- |
| `codex.subagents.max` | 16 | The most subagents a review runs at once. There is no upper bound. 0 turns subagents off, and the review prompt then tells the lead to work alone. |
| `codex.subagents.effort` | `medium` | The subagents' reasoning effort: `low`, `medium`, `high` or `xhigh`. |
| `codex.subagents.min_lines` | 5000 | Reviews of a PR with fewer changed lines (additions plus deletions) run without subagents. 0 allows them on every PR. |

The action uses the default for an unset or malformed value
(`reviewSubagentLimits` in `utils/reviewLenses.ts`).

Before it builds the prompt, the action reads the PR's size from GitHub
(`utils/reviewSubagents.ts`). A re-review counts the whole PR, because every push
re-reads it. Below `codex.subagents.min_lines`, or when the size cannot be read,
the review gets the single-session prompt and `multi_agent_v2 = false`.

- **Model and speed.** Subagents run the lead's model at the configured effort
  (`agents.default_subagent_model` and `default_subagent_reasoning_effort`).
  The lead cannot override either. They inherit the lead's service tier, so an
  Ultrafast review spends Ultrafast allowance on every subagent.
- **Who does what.** Subagents read raw-diff ranges with `read_file`, and that
  coverage counts for the review. They trace lenses and verify candidates. The
  lead alone calls `checkout_pr` and `review_checkpoint`, publishes, and
  accepts each finding after tracing it. `CODEX_SUBAGENT_RULES` in
  `utils/reviewLenses.ts` holds the subagent rules.
- **What enforces it.** Codex has no pre-tool hook that identifies a subagent,
  so instructions keep subagents off lead-only tools. Two checks back them up.
  While a review is in progress, `checkout_pr` refuses a different PR and a
  new head of the same PR. A repeat checkout of the reviewed revision keeps
  the diff artifacts byte-identical, so their read coverage survives.
- **Waiting.** `codex exec` ends when the lead's turn ends, and any subagent
  still working is lost. The lead waits with `wait_agent` until `list_agents`
  shows none running. Each wait returns within 10 minutes and reports its
  start and end on the exec stream, so waiting never trips the activity
  watchdog. The learnings reflection turn never spawns.
- **Accounting.** The exec stream reports only the lead's thread. Each subagent
  writes its own rollout under `$CODEX_HOME/sessions`, and the harness reads
  those rollouts, parsing only the lines added since the last read. The footer lists each subagent with its time and status and
  adds its tokens to the run's. It shows the weekly limit from the session's
  newest report. The harness logs a warning for each subagent still working
  when the process exits.

`checkout_pr` exports `changedFilesPath` with the full PR's old and new rename
paths, and `reviewId` identifying the revision and both numbered and unified diff artifacts. A repository
with a governance provider builds its manifest from that file. The
`review_checkpoint` tool imports manifest version 2: `changed_files`,
`instruction_files` with SHA-256 hashes, and `mechanical_checks` with `id`,
`source`, `class`, `applies_to_diff`, and `enforced_by` for invariants. The
provider owns rule discovery and applicability. Repositories without a provider
record where the agent checked; their baseline and lens passes still apply.

The checkpoint requires a decision for every lens and evidence for each selected
pass and applicable sweep. Invariants, procedures, and excluded checks are
accounted for without asking the reviewer to rerun CI or judge author behavior.
Full-PR manifest scope is conservative. Every run reads the whole raw patch.
The plan returns `priorReviewComplete`: true when a complete review of the
previous head was verified, so earlier-commit findings follow the re-review
rules; false when there is no usable prior review, so they are reported at any
severity. Prior feedback is deduplicated in both cases. Repository guidance supplies domain-specific checks.

`read_file` returns complete UTF-8 pages with `next_cursor`, `eof`, and
`complete_through_line`. Use `start_line` to begin a remaining range. Lines
count toward coverage only after all their fragments are delivered. Reads run
inside the shell sandbox and enforce checkout/temporary-directory boundaries
and secret-path exclusions. Captured review artifacts are hash-checked before
they receive coverage. `review_checkpoint` action `status` lists unread raw
patch ranges and unfinished passes. The numbered display supplies inline
anchors; it cannot substitute for raw-patch coverage. Paged reads require Linux
descriptor-path validation and fail closed on other operating systems.

Published reviews include a hidden, harness-generated coverage receipt. A later
run accepts it only from a submitted recognized bot review for the exact
repository, PR, and previous commit, with a matching digest in the existing
`pullfrog` check's `external_id`. The harness can write that metadata; the
agent's role-mirrored GitHub token cannot. A missing check, overwritten digest,
or failed API call sets `priorReviewComplete: false` without blocking review
publication. Only a completed baseline with an incremental delta, the same base
commit, and the same complete guidance-source hash set counts as a complete
prior review. Missing, malformed, oversized, or incompatible receipts, and
repositories without hashed guidance, count as no prior review. Old pass
evidence is never imported as a fresh conclusion. Receipts persist through
GitHub reviews and do not require a backend deployment.

Review submission and incremental acknowledgement reject incomplete coverage
unless the session explicitly declares a limitation. Such reports cannot approve
and keep the useful summary and inline findings beneath a short incomplete
status. The checkpoint's `reason` stays internal; `public_summary` names the
unchecked work and blocker in plain language. Publication also rechecks the
remote head and base revision. The completion loop resumes unfinished work.
Shell results distinguish output pagination, missing tools, missing
dependencies, missing paths, and timeouts so the reviewer can choose an
appropriate recovery. Pagination is progress, not a failed retry. Required
checks that remain blocked cannot approve the PR. Evidence structure and
delivered reads are validated; comprehension and finding correctness still
require judgment.
Detailed records stay in the run transcript, with only actionable findings and
material limitations in the posted review.

Implementation: `utils/reviewLenses.ts`, `utils/reviewCoverage.ts`,
`utils/reviewResume.ts`, `mcp/readFile.ts`, `mcp/reviewCheckpoint.ts`, and their
checkout, publication, and completion hooks.
The unit tests exercise invalid manifests, rename scope, stale revisions,
failed sweeps, missing evidence, and both review modes:

```bash
pnpm exec vitest run utils/reviewCoverage.test.ts utils/reviewResume.test.ts mcp/readFile.test.ts mcp/shellRecovery.test.ts
```

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
