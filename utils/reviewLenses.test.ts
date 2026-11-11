import { describe, expect, it } from "vitest";
import { computeModes } from "../modes.ts";
import { DEFAULT_REVIEW_SUBAGENTS, reviewSubagentLimits } from "./reviewLenses.ts";

describe("reviewSubagentLimits", () => {
  it("applies saved settings, with no upper bound on the maximum and 0 kept as off", () => {
    expect(reviewSubagentLimits({ max: 40, effort: "high" })).toEqual({ max: 40, effort: "high" });
    expect(reviewSubagentLimits({ max: 0, effort: "xhigh" })).toEqual({ max: 0, effort: "xhigh" });
    expect(reviewSubagentLimits({ max: 1_000 })).toEqual({ max: 1_000, effort: DEFAULT_REVIEW_SUBAGENTS.effort });
  });
  const D = DEFAULT_REVIEW_SUBAGENTS;
  it.each([
    [undefined, D],
    [{}, D],
    [{ max: -1 }, D],
    [{ max: 2.5 }, D],
    [{ max: "8" }, D],
    [{ max: 3, effort: "max" }, { max: 3, effort: D.effort }],
    [{ effort: 3 }, D],
  ])("falls back to the default for unset or malformed %j", (settings, expected) => {
    expect(reviewSubagentLimits(settings)).toEqual(expected);
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
    expect(text).toContain("Subagents are off for this repository");
    expect(text).not.toContain("spawn_agent");
    expect(text).not.toContain("wait_agent");
  });
});
