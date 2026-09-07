import { describe, expect, it } from "vitest";
import { initToolState } from "../toolState.ts";
import { buildPullfrogFooter, stripExistingFooter } from "./buildPullfrogFooter.ts";
import { frogFacts } from "./frogFacts.ts";
import { recordTokens, recordToolUse, renderRunStats } from "./runStats.ts";

describe("frog facts in run stats", () => {
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
});
