// FORK: whether this run's Codex review may use subagents, decided before the
// prompt is built so the lead gets either the delegation prompt with the
// `multi_agent_v2` tools, or the single-session prompt without them.

import { log } from "./cli.ts";
import type { OctokitWithPlugins } from "./github.ts";
import { type ReviewSubagentLimits, reviewSubagentsForPr } from "./reviewLenses.ts";

/**
 * The subagent limits for this run. A Codex review reads the PR's size (added
 * plus deleted lines) and turns subagents off below `codex.subagents.min_lines`;
 * a failed read also turns them off. Every other run returns `limits` unread.
 */
export async function reviewSubagentsForRun(params: {
  limits: ReviewSubagentLimits;
  codex: boolean;
  prNumber: number | undefined;
  octokit: Pick<OctokitWithPlugins, "rest">;
  repo: { owner: string; name: string };
}): Promise<ReviewSubagentLimits> {
  const { limits } = params;
  if (!params.codex || limits.max === 0) return limits;
  let changedLines: number | null = null;
  if (params.prNumber !== undefined) {
    try {
      const { data } = await params.octokit.rest.pulls.get({ owner: params.repo.owner, repo: params.repo.name, pull_number: params.prNumber });
      changedLines = data.additions + data.deletions;
    } catch (error) {
      log.warning(`» review subagents off: could not read the size of PR #${params.prNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const applied = reviewSubagentsForPr(limits, changedLines);
  log.info(
    `» review subagents: ${applied.max === 0 ? "off" : `up to ${applied.max} at ${applied.effort} effort`} ` +
      `(PR changes ${changedLines ?? "an unknown number of"} lines; codex.subagents.min_lines is ${limits.minLines})`
  );
  return applied;
}
