import { buildConventionsPrompt, repoSetup, scoreConventions, scoreEvaluationIsolation, type ReviewScope } from "../repoConventionsFixture.ts";
import { defineFixture, type TestRunnerOptions } from "../utils.ts";

/**
 * Run both scopes with: pnpm runtest repo-conventions-full repo-conventions-incremental
 * Repeat with REPO_CONVENTIONS_BASELINE=1 for the old instruction comparison.
 * Uses the normal authenticated runner; no GitHub comments or production repo writes.
 * The runner retains structured output and transcripts. Compare caught:* and
 * no_false_positives_or_duplicates separately; one model run is not a quality claim.
 */
const baseline = process.env.REPO_CONVENTIONS_BASELINE === "1";
function evaluation(scope: ReviewScope): TestRunnerOptions {
  return {
    name: `repo-conventions-${scope}`,
    fixture: defineFixture({
      prompt: buildConventionsPrompt(scope, baseline),
      shell: "enabled",
      push: "disabled",
      timeout: "5m",
    }, { localOnly: true }),
    repoSetup,
    validator: (result) => [
      ...scoreEvaluationIsolation(result.output),
      ...scoreConventions(result.structuredOutput, scope),
    ],
    retryOnTimeout: false,
    tags: ["adhoc"],
  };
}

export const tests = {
  "repo-conventions-full": evaluation("full"),
  "repo-conventions-incremental": evaluation("incremental"),
};
