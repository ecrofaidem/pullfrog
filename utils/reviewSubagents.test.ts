import { describe, expect, it, vi } from "vitest";
import { computeModes } from "../modes.ts";
import { DEFAULT_REVIEW_SUBAGENTS } from "./reviewLenses.ts";
import { reviewSubagentsForRun } from "./reviewSubagents.ts";

const repo = { owner: "o", name: "r" };
type Get = ReturnType<typeof vi.fn>;
const octokit = (get: () => Promise<unknown>) => ({ rest: { pulls: { get: vi.fn(get) } } });
const sized = (additions: number, deletions: number) => octokit(async () => ({ data: { additions, deletions } }));
const review = { type: "review", event: { trigger: "pull_request_opened", issue_number: 7 } };
const run = (overrides: Omit<Partial<Parameters<typeof reviewSubagentsForRun>[0]>, "octokit"> & { octokit: ReturnType<typeof octokit> }) =>
  reviewSubagentsForRun({ settings: {}, agentId: "codex", isDocsUpdate: false, payload: review, repo, ...overrides, octokit: overrides.octokit as never });

describe("reviewSubagentsForRun", () => {
  it.each([
    [4_000, 999, 0],
    [4_000, 1_000, DEFAULT_REVIEW_SUBAGENTS.max],
  ])("a Codex review of a PR with +%s/-%s gets max %s, and its prompt agrees", async (additions, deletions, max) => {
    const client = sized(additions, deletions);
    const limits = await run({ octokit: client });
    expect(limits.max).toBe(max);
    expect(client.rest.pulls.get as Get).toHaveBeenCalledWith({ owner: "o", repo: "r", pull_number: 7 });
    const prompt = computeModes("codex", false, limits.max).find((mode) => mode.name === "Review")!.prompt!;
    expect(prompt.includes("Subagents are off for this review")).toBe(max === 0);
    expect(prompt.includes("spawn_agent")).toBe(max > 0);
  });

  it("reads the repository settings by their run-context names", async () => {
    const settings = { codexSubagentMax: 40, codexSubagentEffort: "high", codexSubagentMinLines: 100 };
    expect(await run({ settings, octokit: sized(60, 40) })).toEqual({ max: 40, effort: "high", minLines: 100 });
    expect(await run({ settings, octokit: sized(60, 39) })).toEqual({ max: 0, effort: "high", minLines: 100 });
  });

  it.each([
    ["an IncrementalReview push", { type: "incremental_review", event: { trigger: "pull_request_synchronize", issue_number: 7 } }],
    ["an @prfrog review comment", { type: "review", event: { trigger: "issue_comment_created", issue_number: 7 } }],
  ])("gates %s the same way", async (_name, payload) => {
    expect((await run({ payload, octokit: sized(10, 0) })).max).toBe(0);
    expect((await run({ payload, octokit: sized(10_000, 0) })).max).toBe(DEFAULT_REVIEW_SUBAGENTS.max);
  });

  it("turns subagents off when the PR size cannot be read, or the run has no PR", async () => {
    const failing = octokit(async () => { throw new Error("502 Bad Gateway"); });
    expect((await run({ octokit: failing })).max).toBe(0);
    expect((await run({ payload: { type: "review", event: { trigger: "workflow_dispatch" } }, octokit: sized(1e6, 0) })).max).toBe(0);
  });

  it.each([
    ["another harness", { agentId: "opencode" as const }],
    ["a docs update", { isDocsUpdate: true }],
    ["a non-review run", { payload: { type: "task", event: { trigger: "issue_comment_created", issue_number: 7 } } }],
    ["subagents already off", { settings: { codexSubagentMax: 0 } }],
  ])("leaves %s unread", async (_name, overrides) => {
    const client = sized(1e6, 0);
    await run({ ...overrides, octokit: client });
    expect(client.rest.pulls.get as Get).not.toHaveBeenCalled();
  });
});
