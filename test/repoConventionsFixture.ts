import type { ValidationCheck } from "./utils.ts";
import { REVIEW_CONVENTIONS } from "../utils/reviewConventions.ts";

export const fixtureDirectory = "repo-conventions-fixture";
const guidanceAliases: Record<string, string> = {
  "AGENTS.md": ".claude/CLAUDE.md",
  "dashboard/AGENTS.md": "dashboard/.claude/CLAUDE.md",
  "automation/AGENTS.md": "automation/.claude/CLAUDE.md",
};
const dashboardRules = "dashboard/.claude/rules/components.md";
const automationRules = "automation/.claude/rules/python.md";
export const rules = {
  filters: "Every dashboard page query must forward the active page filters to its data loader.",
  generated: "Product fixes must not edit generated dashboard/app/components/ui primitives; compose them in feature components.",
  imports: "CM policy modules must not import cm.execution modules; policy produces queue requests for execution.",
};
export const guidance: Record<string, string> = {
  ".claude/CLAUDE.md": `Written rules outrank current docs, generated artifacts, and comparable code, in that order.
Read the applicable nested AGENTS.md and the rules they reference.
Read docs/review-extra.md for additional review guidance.
Review only introduced or amplified issues in the requested diff.
`,
  "dashboard/.claude/CLAUDE.md": "Read .claude/rules/components.md relative to dashboard before reviewing dashboard changes.\n",
  [dashboardRules]: `${rules.filters}\n${rules.generated}
Exception: the frozen number-field subtree may receive accessibility fixes directly.
For formatting, docs/format-a.md and docs/format-b.md are both active and have equal authority.
`,
  "automation/.claude/CLAUDE.md": "Read .claude/rules/python.md relative to automation before reviewing automation changes.\n",
  [automationRules]: `${rules.imports}
Application environment access must use the shared settings module.
Exception: standalone scripts under automation/scripts may read their environment directly.
`,
  "docs/format-a.md": "Dashboard utility string literals must use single quotes.\n",
  "docs/format-b.md": "Dashboard utility string literals must use double quotes.\n",
};
const findings = [
  { file: "dashboard/app/pages/report.ts", path: dashboardRules, quote: rules.filters },
  { file: "dashboard/app/components/ui/Button.vue", path: dashboardRules, quote: rules.generated },
  { file: "automation/cm/policy/choose.py", path: automationRules, quote: rules.imports },
];
export type ReviewScope = "full" | "incremental";
export function expectedFindings(scope: ReviewScope) {
  return scope === "full" ? findings : findings.slice(0, 1);
}

export const before: Record<string, string> = {
  ...guidance,
  "dashboard/app/pages/report.ts": "export const loadReport = (filters: object, loader: Function) => loader(filters);\n",
  "dashboard/app/pages/legacy.ts": "export const loadLegacy = (filters: object, loader: Function) => loader({});\n",
  "dashboard/app/components/ui/Button.vue": '<template><button><slot /></button></template>\n',
  "dashboard/app/components/ui/number-field/NumberField.vue": '<template><input type="number" /></template>\n',
  "dashboard/app/utils/format.ts": "export const label = 'Report';\n",
  "automation/cm/policy/choose.py": 'def choose():\n    return {"action": "reply"}\n',
  "automation/cm/execution/phone.py": "def send_reply():\n    pass\n",
  "automation/scripts/status.py": 'print("status")\n',
};
export const after: Record<string, string> = {
  "dashboard/app/pages/report.ts": "export const loadReport = (filters: object, loader: Function) => loader({});\n",
  "dashboard/app/components/ui/Button.vue": '<template><button class="campaign-report-primary"><slot /></button></template>\n',
  "dashboard/app/components/ui/number-field/NumberField.vue": '<template><input type="number" aria-label="Quantity" /></template>\n',
  "dashboard/app/utils/format.ts": 'export const label = "Report showing the selected campaign and platform activity in the current window";\n',
  "automation/cm/policy/choose.py": 'from cm.execution.phone import send_reply\n\ndef choose():\n    send_reply()\n    return {"action": "reply"}\n',
  "automation/scripts/status.py": 'import os\n\nprint(os.environ.get("STATUS_LABEL", "status"))\n',
};

// Trusted setup runs before the agent, inside the runner's disposable checkout.
// Base -> previous includes all changes except report.ts; previous -> head is the delta.
export const repoSetup = `node -e '${`
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
fs.mkdirSync(${JSON.stringify(fixtureDirectory)});
process.chdir(${JSON.stringify(fixtureDirectory)});
const write = files => Object.entries(files).forEach(([name, content]) => {
  fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, content);
});
const git = (...args) => cp.execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8" });
git("init", "--quiet"); git("config", "user.name", "Conventions fixture"); git("config", "user.email", "fixture@example.invalid");
write(${JSON.stringify(before)});
for (const prefix of ["", "dashboard/", "automation/"]) fs.symlinkSync(".claude/CLAUDE.md", prefix + "AGENTS.md");
git("add", "."); git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "base");
const base = git("rev-parse", "HEAD").trim();
const changes = ${JSON.stringify(after)};
const report = "dashboard/app/pages/report.ts";
write(Object.fromEntries(Object.entries(changes).filter(([name]) => name !== report)));
git("add", "."); git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "previous review");
const previous = git("rev-parse", "HEAD").trim();
write({ [report]: changes[report] }); git("add", ".");
git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "latest update");
fs.writeFileSync("full.diff", git("diff", base, "HEAD"));
fs.writeFileSync("incremental.diff", git("diff", previous, "HEAD"));
`.replaceAll("'", "'\\''")}'`;

export function buildConventionsPrompt(scope: ReviewScope, baseline = false): string {
  const instructions = baseline
    ? "Read the repository's AGENTS.md or equivalent. Drop praise, style preferences, speculative/unverified claims, findings about pre-existing code unrelated to the PR, and anything not actionable."
    : REVIEW_CONVENTIONS;
  return `This is a focused prompt evaluation in a local synthetic repository, not a live PR review. If Pullfrog's select_mode tool is available, select Task mode. Do not select Review or IncrementalReview, load review skills, or dispatch specialists: those would inject additional review instructions and invalidate the comparison. Use only the supplied procedure below.
Review the local synthetic repository at ${fixtureDirectory}/. Do not checkout another PR, edit files, or post to GitHub.
The PR makes campaign report styling, accessibility, status-script, policy, and report-loading changes.
Read full.diff inside that repository as the authoritative PR diff.
${scope === "incremental" ? "This is an incremental review. Read incremental.diff first; only report issues introduced or amplified in that delta. The full diff provides context." : "This is a full review; report actionable issues introduced by the full diff."}

${instructions}

Call set_output with JSON in this format (all paths relative to the synthetic repository):
{"findings":[{"file":"changed source path","consequence":"concrete impact","rule":{"path":"resolved guidance source path","quote":"exact complete rule sentence"}}],
"guidance":[{"path":"resolved source path actually consulted","quote":"exact sentence from that source"}],
"unavailable":["referenced guidance path that could not be read"],
"conflicts":[{"paths":["conflicting guidance paths"],"reason":"unresolved contradiction"}]}
Use empty arrays where appropriate. Record the sources and limitations actually encountered; do not invent evidence.`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function citation(value: unknown): value is { path: string; quote: string } {
  return object(value) && typeof value.path === "string" && typeof value.quote === "string";
}
export function scoreConventions(output: string | null, scope: ReviewScope): ValidationCheck[] {
  let parsed: unknown;
  try { parsed = JSON.parse(output ?? ""); } catch { /* malformed output fails below */ }
  if (!object(parsed) || !Array.isArray(parsed.findings) || !parsed.findings.every((finding) =>
    object(finding) && typeof finding.file === "string" && typeof finding.consequence === "string" &&
    finding.consequence.trim().length > 0 && citation(finding.rule)) ||
    !Array.isArray(parsed.guidance) || !parsed.guidance.every(citation) ||
    !Array.isArray(parsed.unavailable) || !parsed.unavailable.every((path) => typeof path === "string") ||
    !Array.isArray(parsed.conflicts) || !parsed.conflicts.every((conflict) => object(conflict) &&
      Array.isArray(conflict.paths) && conflict.paths.every((path) => typeof path === "string") &&
      typeof conflict.reason === "string" && conflict.reason.trim().length > 0)) {
    return [{ name: "valid_review_output", passed: false }];
  }
  const expected = expectedFindings(scope);
  const reported = parsed.findings;
  const checks: ValidationCheck[] = [{ name: "valid_review_output", passed: true }];
  for (const finding of expected) {
    checks.push({ name: `caught:${finding.file}`, passed: reported.some((item) => item.file === finding.file) });
  }
  checks.push({ name: "no_false_positives_or_duplicates", passed: reported.every((item, i) =>
    expected.some((finding) => finding.file === item.file) && reported.findIndex((other) => other.file === item.file) === i) });
  checks.push({ name: "correct_rule_evidence", passed: reported.every((item) => expected.some((finding) =>
    finding.file === item.file && item.rule.path === finding.path && item.rule.quote === finding.quote)) });
  const consulted = parsed.guidance.map((source) => ({
    ...source, path: guidanceAliases[source.path] ?? source.path,
  }));
  const validCitation = (source: { path: string; quote: string }) =>
    guidance[source.path]?.split("\n").some((line) => line.trim().length > 0 && line.trim() === source.quote) === true;
  // Exact quotations establish output evidence, not an independently audited file-read trace.
  const required = scope === "full" ? Object.keys(guidance) : [".claude/CLAUDE.md", "dashboard/.claude/CLAUDE.md", dashboardRules];
  checks.push({ name: "consulted_guidance_evidence", passed: consulted.every(validCitation) &&
    required.every((path) => consulted.some((source) => source.path === path)) });
  checks.push({ name: "missing_guidance_recorded", passed: parsed.unavailable.includes("docs/review-extra.md") });
  if (scope === "full") checks.push({ name: "conflicting_guidance_recorded", passed: parsed.conflicts.some((conflict) =>
    conflict.paths.includes("docs/format-a.md") && conflict.paths.includes("docs/format-b.md")) });
  return checks;
}

/** Reject a baseline that accidentally loaded the production review pass. */
export function scoreEvaluationIsolation(trace: string): ValidationCheck[] {
  const modes = [...trace.matchAll(/» [\w.]*select_mode\((\{[^)]*\})\)/g)].map((match) => {
    try { return JSON.parse(match[1]).mode; } catch { return undefined; }
  });
  const skillCalls = [...trace.matchAll(/» (?:[\w.]*__)?(?:skill|Skill)\((\{[^)]*\})\)/g)];
  const skillInvocations = [...trace.matchAll(/» (?:[\w.]*__)?(?:skill|Skill)\(/g)];
  const onlyWritingSkills = skillCalls.length === skillInvocations.length && skillCalls.every((match) => {
    try {
      const input = JSON.parse(match[1]);
      return ["write-good-docs", "simple-english"].includes(input.name ?? input.skill);
    } catch { return false; }
  });
  return [
    { name: "neutral_task_mode", passed: modes.length > 0 && modes.every((mode) => typeof mode === "string" && mode.toLowerCase() === "task") },
    { name: "no_review_skills_or_specialists", passed: onlyWritingSkills && !/» (?:[\w.]*__)?(?:task|Task|Agent|spawn_agent)\(/.test(trace) },
  ];
}
