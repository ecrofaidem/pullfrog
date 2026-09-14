import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckRun, GitHubError } from "../convex/lib/github";

const params = {
  token: "fixture-token",
  owner: "owner",
  repo: "repo",
  name: "Pullfrog",
  headSha: "head",
  detailsUrl: "https://example.com/run",
};
const now = "2026-09-14T12:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: 10 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createCheckRun", () => {
  it("creates a skipped check already completed in a single POST", async () => {
    expect(await createCheckRun({ ...params, skippedSummary: "Base-only merge" })).toEqual({ id: 10 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/check-runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: params.name,
          head_sha: params.headSha,
          status: "completed",
          conclusion: "skipped",
          completed_at: now,
          output: { title: "skipped", summary: "Base-only merge" },
          details_url: params.detailsUrl,
        }),
      }),
    );
  });

  it("preserves the in-progress payload for normal checks", async () => {
    await createCheckRun(params);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/check-runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: params.name,
          head_sha: params.headSha,
          status: "in_progress",
          started_at: now,
          details_url: params.detailsUrl,
        }),
      }),
    );
  });

  it("propagates a failed skipped-check POST without creating an in-progress check", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(createCheckRun({ ...params, skippedSummary: "Base-only merge" })).rejects.toBeInstanceOf(GitHubError);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      status: "completed",
      conclusion: "skipped",
    });
  });
});
