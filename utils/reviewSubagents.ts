// FORK: whether this run's Codex review may use subagents, decided before the
// prompt is built so the lead gets either the delegation prompt with the
// `multi_agent_v2` tools, or the single-session prompt without them.

import type { AgentId } from "../external.ts";
import { log } from "./cli.ts";
import { isReviewRun } from "./codexSpeed.ts";
import type { OctokitWithPlugins } from "./github.ts";
import { type ReviewSubagentLimits, reviewSubagentLimits, reviewSubagentsForPr } from "./reviewLenses.ts";
import type { RepoSettings } from "./runContext.ts";

/**
 * The subagent limits for this run, from the repo's `codex.subagents.*`
 * settings. A Codex review reads the PR's size (added plus deleted lines) and
 * turns subagents off below `codex.subagents.min_lines`; a failed read also
 * turns them off. Every other run returns the settings unread.
 */
export async function reviewSubagentsForRun(params: {
  settings: Pick<RepoSettings, "codexSubagentMax" | "codexSubagentEffort" | "codexSubagentMinLines">;
  agentId: AgentId;
  isDocsUpdate: boolean;
  payload: { type?: string | undefined; event: { trigger: string; issue_number?: number | undefined } };
  octokit: Pick<OctokitWithPlugins, "rest">;
  repo: { owner: string; name: string };
}): Promise<ReviewSubagentLimits> {
  const limits = reviewSubagentLimits({
    max: params.settings.codexSubagentMax,
    effort: params.settings.codexSubagentEffort,
    minLines: params.settings.codexSubagentMinLines,
  });
  const codexReview = params.agentId === "codex" && !params.isDocsUpdate && isReviewRun(params.payload);
  if (!codexReview || limits.max === 0) return limits;
  const prNumber = params.payload.event.issue_number;
  let changedLines: number | null = null;
  if (prNumber !== undefined) {
    try {
      const { data } = await params.octokit.rest.pulls.get({ owner: params.repo.owner, repo: params.repo.name, pull_number: prNumber });
      changedLines = data.additions + data.deletions;
    } catch (error) {
      log.warning(`» review subagents off: could not read the size of PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const applied = reviewSubagentsForPr(limits, changedLines);
  log.info(
    `» review subagents: ${applied.max === 0 ? "off" : `up to ${applied.max} at ${applied.effort} effort`} ` +
      `(PR changes ${changedLines ?? "an unknown number of"} lines; codex.subagents.min_lines is ${limits.minLines})`
  );
  return applied;
}
