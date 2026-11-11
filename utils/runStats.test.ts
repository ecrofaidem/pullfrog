import { describe, expect, it } from "vitest";
import { initToolState, primaryRepoState } from "../toolState.ts";
import { buildPullfrogFooter, stripExistingFooter } from "./buildPullfrogFooter.ts";
import { frogFacts } from "./frogFacts.ts";
import { recordTokens, recordToolUse, renderRunStats, setSubagentReader } from "./runStats.ts";

describe("frog facts in run stats", () => {
  it("reports measured Codex raw-diff coverage without presenting reused reads as new work", () => {
    const toolState = initToolState({ owner: "test", name: "repo", dir: "/tmp/repo", progressComment: undefined });
    toolState.agent = "codex";
    primaryRepoState(toolState).reviewCoverage = { scope: { id: "scope", pullNumber: 1, headSha: "head", baseSha: "base", changedFiles: [], changedFilesPath: "/tmp/files", diffPath: "/tmp/raw.diff" }, passes: {}, readCoverage: [{ diffPath: "/tmp/raw.diff", totalLines: 10, tocEntries: [], coveredRanges: [{ startLine: 1, endLine: 5 }], coveragePreflightRan: false }] };
    const stats = renderRunStats({ toolState })!;
    expect(stats.line).toContain("50% diff coverage");
    expect(stats.details).toContain("5 of 10 raw diff lines covered");
    expect(stats.details).toContain("may include verified prior reads");
    expect(stats.details).not.toContain("changed lines read");
  });
  it("has at least 250 distinct, short, plain-text facts with source links", () => {
    expect(frogFacts.length).toBeGreaterThanOrEqual(250);
    expect(new Set(frogFacts.map(({ text }) => text)).size).toBe(frogFacts.length);
    for (const { text, source } of frogFacts) {
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(180);
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(25);
      expect(text).not.toMatch(/[<>&\n\r\u2013\u2014]/);
      expect(source).toMatch(/^https:\/\/[a-z.]+\/[a-zA-Z_\-/]+$/);
    }
  });

  it("keeps one sourced fact inside the dropdown when stats change", () => {
    const toolState = initToolState({
      owner: "ecrofaidem", name: "monorepo", dir: "/tmp/monorepo", progressComment: undefined,
    });
    toolState.agent = "codex";
    const first = renderRunStats({ toolState })!;
    const fact = frogFacts.find(({ text }) => first.details.includes(text));
    expect(fact).toBeDefined();
    const smallText = `<sub><a href="${fact!.source}">Frog fact</a>: ${fact!.text}</sub>`;
    expect(first.line).not.toContain("Frog fact");
    expect(first.details).toContain(`\n\n${smallText}\n\n</details>`);
    expect(first.details.startsWith("<details><summary>Run stats</summary>")).toBe(true);

    recordTokens({ input: 1000, output: 100 });
    recordToolUse("read_file");
    const updated = renderRunStats({ toolState, review: { inlineComments: 2, droppedComments: 1 } })!;
    expect(updated.details).toContain(smallText);
    expect(updated.details).toContain("- Tokens: 1K in");
    expect(updated.details).toContain("- Tool calls: 1 (read_file 1)");
    expect(updated.details).toContain("- Review: 2 inline comments (1 dropped: outside the diff)");
    expect(updated.details).not.toContain("Diff coverage");

    const body = "Review complete.";
    const comment = body + buildPullfrogFooter({ toolState });
    expect(comment.match(/Frog fact/g)).toHaveLength(1);
    expect(comment).toContain(smallText);
    expect(stripExistingFooter(comment)).toBe(body);
  });

  it("keeps trial disclosure and fork stats together without restoring hosted action links", () => {
    const toolState = initToolState({
      owner: "ecrofaidem", name: "monorepo", dir: "/tmp/monorepo", progressComment: undefined,
    });
    toolState.agent = "codex";
    const body = "Review complete.";
    const footer = buildPullfrogFooter({
      owner: "ecrofaidem",
      model: "openai/gpt-astra",
      clamped: { from: "openai/gpt-astra", reason: "trial" },
      toolState,
      review: { inlineComments: 2, droppedComments: 1 },
      customParts: ["[Fix all](https://pullfrog.com/trigger)"],
    });
    expect(footer).toContain("Pullfrog covered this run's model usage.");
    expect(footer).toContain("https://pullfrog.com/console/ecrofaidem");
    expect(footer).toContain("<details><summary>Run stats</summary>");
    expect(footer).toContain("- Review: 2 inline comments (1 dropped: outside the diff)");
    expect(footer.match(/Frog fact/g)).toHaveLength(1);
    expect(footer).not.toContain("https://pullfrog.com/trigger");
    expect(stripExistingFooter(body + footer)).toBe(body);
  });
});

describe("subagents read at footer time", () => {
  it("counts each subagent with its time and status, and adds its tokens to the run's", () => {
    const toolState = initToolState({ owner: "test", name: "repo", dir: "/tmp/repo", progressComment: undefined });
    toolState.agent = "codex";
    const before = renderRunStats({ toolState })!;
    expect(before.details).not.toContain("Subagents");
    let calls = 0;
    setSubagentReader(() => {
      calls += 1;
      return [
        { label: "color", seconds: 3.1, status: "completed", tokens: { input: 25_897, output: 5, cacheRead: 0, costUsd: 0.05 } },
        { label: "fruit", seconds: 64, status: "unfinished", tokens: { input: 25_899, output: 5, cacheRead: 25_728, costUsd: 0.01 } },
      ];
    });
    try {
      const stats = renderRunStats({ toolState })!;
      expect(calls).toBe(1);
      expect(stats.line).toContain("2 subagents");
      expect(stats.details).toContain("- Subagents: 2 (51.8K in · 10 out): color 3s · fruit 1m 04s (unfinished)");
      const tokens = (details: string) => Number(details.match(/- Tokens: ([\d.]+)K in/)?.[1] ?? 0);
      expect(tokens(stats.details) - tokens(before.details)).toBeCloseTo(51.8, 1);
    } finally {
      setSubagentReader(() => []);
    }
  });
});
