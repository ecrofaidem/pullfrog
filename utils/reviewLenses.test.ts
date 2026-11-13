import { describe, expect, it } from "vitest";
import { computeModes } from "../modes.ts";
import { DEFAULT_REVIEW_SUBAGENTS, reviewSubagentLimits, reviewSubagentsForPr } from "./reviewLenses.ts";

describe("reviewSubagentLimits", () => {
  it("applies saved settings, with no upper bound on the maximum and 0 kept as off", () => {
    expect(reviewSubagentLimits({ max: 40, effort: "high", minLines: 20_000 })).toEqual({ max: 40, effort: "high", minLines: 20_000 });
    expect(reviewSubagentLimits({ max: 0, effort: "xhigh", minLines: 0 })).toEqual({ max: 0, effort: "xhigh", minLines: 0 });
    expect(reviewSubagentLimits({ max: 1_000 })).toEqual({ ...DEFAULT_REVIEW_SUBAGENTS, max: 1_000 });
  });
  const D = DEFAULT_REVIEW_SUBAGENTS;
  it.each([
    [undefined, D],
    [{}, D],
    [{ max: -1 }, D],
    [{ max: 2.5 }, D],
    [{ max: "8" }, D],
    [{ max: 3, effort: "max" }, { ...D, max: 3 }],
    [{ minLines: -5 }, D],
    [{ minLines: "100" }, D],
    [{ effort: 3 }, D],
  ])("falls back to the default for unset or malformed %j", (settings, expected) => {
    expect(reviewSubagentLimits(settings)).toEqual(expected);
  });
});

describe("reviewSubagentsForPr", () => {
  const limits = { max: 16, effort: "medium" as const, minLines: 5_000 };
  it.each([
    [4_999, 0],
    [5_000, 16],
    [181_544, 16],
    [null, 0],
  ])("a PR changing %s lines gets max %s", (lines, max) => {
    expect(reviewSubagentsForPr(limits, lines)).toEqual({ ...limits, max });
  });
  it("allows subagents on every PR at min_lines 0, but never on an unknown size", () => {
    expect(reviewSubagentsForPr({ ...limits, minLines: 0 }, 0).max).toBe(16);
    expect(reviewSubagentsForPr({ ...limits, minLines: 0 }, null).max).toBe(0);
  });
});

describe("the Codex review prompt", () => {
  const prompt = (max: number, mode = "Review") => computeModes("codex", false, max).find((m) => m.name === mode)!.prompt!;
  it.each(["Review", "IncrementalReview"])("names the repository's limit in %s", (mode) => {
    expect(prompt(40, mode)).toContain("up to 40 at once");
    expect(prompt(40, mode)).toContain('fork_turns="none"');
  });
  it.each(["Review", "IncrementalReview"])("tells %s to work alone when subagents are off", (mode) => {
    const text = prompt(0, mode);
    expect(text).toContain("Subagents are off for this review");
    expect(text).not.toContain("spawn_agent");
    expect(text).not.toContain("wait_agent");
  });
});
