import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectedFindings, fixtureDirectory, guidance, repoSetup, scoreConventions, scoreEvaluationIsolation, type ReviewScope } from "./repoConventionsFixture.ts";

function review(scope: ReviewScope = "full") {
  return {
    findings: expectedFindings(scope).map(({ file, path, quote }) => ({
      file, consequence: "The changed code violates the applicable contract.", rule: { path, quote },
    })),
    guidance: Object.entries(guidance).map(([path, content]) => ({ path, quote: content.trim().split("\n")[0] })),
    unavailable: ["docs/review-extra.md"],
    conflicts: [{ paths: ["docs/format-a.md", "docs/format-b.md"], reason: "Opposite quote requirements with equal authority." }],
  };
}
function failures(value: unknown, scope: ReviewScope = "full") {
  return scoreConventions(JSON.stringify(value), scope).filter((check) => !check.passed).map((check) => check.name);
}

describe("repository convention scoring", () => {
  it.each(["full", "incremental"] as const)("accepts supported findings and permitted exceptions in %s scope", (scope) => {
    expect(failures(review(scope), scope)).toEqual([]);
  });
  it.each([null, "not json", "null", "[]", '{"findings":[null]}'])("rejects malformed output %s", (value) => {
    expect(scoreConventions(value, "full")).toEqual([{ name: "valid_review_output", passed: false }]);
  });
  it("counts every missed expected finding", () => {
    expect(failures({ ...review(), findings: [] })).toEqual(expectedFindings("full").map(({ file }) => `caught:${file}`));
  });
  it.each([
    "dashboard/app/components/ui/number-field/NumberField.vue",
    "automation/scripts/status.py",
    "dashboard/app/pages/legacy.ts",
    "dashboard/app/utils/format.ts",
    "unexpected/file.ts",
  ])("rejects a false positive on %s", (file) => {
    const output = review();
    output.findings.push({ ...output.findings[0], file });
    expect(failures(output)).toContain("no_false_positives_or_duplicates");
  });
  it("rejects unchanged prior-review findings in incremental scope", () => {
    expect(failures(review(), "incremental")).toContain("no_false_positives_or_duplicates");
  });
  it("rejects duplicate findings", () => {
    const output = review();
    output.findings.push(output.findings[0]);
    expect(failures(output)).toContain("no_false_positives_or_duplicates");
  });
  it.each(["path", "quote"] as const)("rejects incorrect rule %s", (field) => {
    const output = review();
    output.findings[0].rule[field] = "invented evidence";
    expect(failures(output)).toContain("correct_rule_evidence");
  });
  it("rejects missing or fabricated guidance evidence", () => {
    const output = review();
    output.guidance[0].quote = "The agent did not actually read this rule.";
    expect(failures(output)).toContain("consulted_guidance_evidence");
    expect(failures({ ...review(), guidance: [] })).toContain("consulted_guidance_evidence");
  });
  it("requires missing and conflicting sources to be recorded", () => {
    expect(failures({ ...review(), unavailable: [], conflicts: [] })).toEqual([
      "missing_guidance_recorded", "conflicting_guidance_recorded",
    ]);
  });
  it("rejects a quoted fragment instead of a complete guidance sentence", () => {
    const output = review();
    output.guidance[0].quote = "Written rules outrank current";
    expect(failures(output)).toContain("consulted_guidance_evidence");
  });
  it("accepts the fixture's actual AGENTS symlink aliases as citation paths", () => {
    const output = review();
    output.guidance = output.guidance.map((source) => ({ ...source,
      path: source.path.replace(".claude/CLAUDE.md", "AGENTS.md"),
    }));
    expect(failures(output)).toEqual([]);
  });
});

describe("evaluation isolation", () => {
  it("accepts the neutral Task mode tool trace", () => {
    expect(scoreEvaluationIsolation('» pullfrog_select_mode({"mode":"Task"})').every((check) => check.passed)).toBe(true);
  });
  it("accepts multiline mode arguments and the required report-writing skills", () => {
    const trace = '» pullfrog_select_mode({\n  "mode": "Task"\n})\n» skill({"name":"write-good-docs"})\n» Skill({"skill":"simple-english"})';
    expect(scoreEvaluationIsolation(trace).every((check) => check.passed)).toBe(true);
  });
  it.each([
    '',
    '» pullfrog_select_mode({"mode":"Review"})',
    '» pullfrog_select_mode({"mode":"Task"})\n» pullfrog_select_mode({"mode":"IncrementalReview"})',
    '» pullfrog_select_mode({"mode":"Task"})\n» task({"subagent_type":"reviewfrog"})',
    '» pullfrog_select_mode({"mode":"Task"})\n» skill({\n  "name": "code-review"\n})',
    '» pullfrog_select_mode({"mode":"Task"})\n» Task({"subagent_type":"reviewfrog"})',
    '» pullfrog_select_mode({"mode":"Task"})\n» Skill({"skill":"code-review","args":"review changes (all)"})',
  ])("rejects missing or contaminated mode evidence: %s", (trace) => {
    expect(scoreEvaluationIsolation(trace).some((check) => !check.passed)).toBe(true);
  });
});

it("seeds symlinked guidance and excludes prior changes from the incremental diff", () => {
  const directory = mkdtempSync(join(tmpdir(), "conventions-fixture-test-"));
  try {
    execFileSync("bash", ["-c", repoSetup], { cwd: directory });
    const root = join(directory, fixtureDirectory);
    expect(readlinkSync(join(root, "AGENTS.md"))).toBe(".claude/CLAUDE.md");
    expect(readFileSync(join(root, "dashboard/AGENTS.md"), "utf8")).toBe(guidance["dashboard/.claude/CLAUDE.md"]);
    const full = readFileSync(join(root, "full.diff"), "utf8");
    const delta = readFileSync(join(root, "incremental.diff"), "utf8");
    for (const { file } of expectedFindings("full")) expect(full).toContain(`+++ b/${file}`);
    expect(full).not.toContain("legacy.ts");
    expect(delta.match(/^diff --git /gm)).toHaveLength(1);
    expect(delta).toContain("+++ b/dashboard/app/pages/report.ts");
    expect(delta).not.toContain("choose.py");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
