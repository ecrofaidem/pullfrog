import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REVIEW_SUBAGENTS } from "./reviewLenses.ts";
import { reviewSubagentsForRun } from "./reviewSubagents.ts";

const repo = { owner: "o", name: "r" };
const octokit = (get: () => Promise<unknown>) => ({ rest: { pulls: { get: vi.fn(get) } } }) as never;
const sized = (additions: number, deletions: number) => octokit(async () => ({ data: { additions, deletions } }));

describe("reviewSubagentsForRun", () => {
  it.each([
    [4_000, 999, 0],
    [4_000, 1_000, DEFAULT_REVIEW_SUBAGENTS.max],
  ])("a Codex review of a PR with +%s/-%s gets max %s", async (additions, deletions, max) => {
    const client = sized(additions, deletions);
    const limits = await reviewSubagentsForRun({ limits: DEFAULT_REVIEW_SUBAGENTS, codex: true, prNumber: 7, octokit: client, repo });
    expect(limits.max).toBe(max);
    expect((client as { rest: { pulls: { get: ReturnType<typeof vi.fn> } } }).rest.pulls.get).toHaveBeenCalledWith({ owner: "o", repo: "r", pull_number: 7 });
  });

  it("turns subagents off when the PR size cannot be read, or the run has no PR", async () => {
    const failing = octokit(async () => { throw new Error("502 Bad Gateway"); });
    expect((await reviewSubagentsForRun({ limits: DEFAULT_REVIEW_SUBAGENTS, codex: true, prNumber: 7, octokit: failing, repo })).max).toBe(0);
    expect((await reviewSubagentsForRun({ limits: DEFAULT_REVIEW_SUBAGENTS, codex: true, prNumber: undefined, octokit: sized(1e6, 0), repo })).max).toBe(0);
  });

  it("leaves other runs, and reviews with subagents already off, unread", async () => {
    for (const [codex, max] of [[false, 16], [true, 0]] as const) {
      const client = sized(1e6, 0);
      const limits = { ...DEFAULT_REVIEW_SUBAGENTS, max };
      expect(await reviewSubagentsForRun({ limits, codex, prNumber: 7, octokit: client, repo })).toEqual(limits);
      expect((client as { rest: { pulls: { get: ReturnType<typeof vi.fn> } } }).rest.pulls.get).not.toHaveBeenCalled();
    }
  });
});
