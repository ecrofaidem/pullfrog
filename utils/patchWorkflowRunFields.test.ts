import { describe, expect, it, vi } from "vitest";
import type { AgentUsage } from "../agents/shared.ts";
import type { ToolContext } from "../mcp/server.ts";
import { aggregateUsage, patchWorkflowRunFields, type WorkflowRunPatch } from "./patchWorkflowRunFields.ts";

const apiFetch = vi.hoisted(() => vi.fn(async () => new Response(null, { status: 200 })));
vi.mock("./apiFetch.ts", () => ({ apiFetch }));

const entry = (overrides: Partial<AgentUsage>): AgentUsage => ({
  agent: "pullfrog",
  inputTokens: 0,
  outputTokens: 0,
  ...overrides,
});

describe("aggregateUsage", () => {
  it("returns empty object for empty input", () => {
    expect(aggregateUsage([])).toEqual({});
  });

  it("drops fields that sum to zero so NULL stays 'not reported'", () => {
    // a run that only recorded input tokens shouldn't write zero into output/cache/cost —
    // those columns stay NULL so dashboards can tell 'zero' from 'never reported'.
    expect(aggregateUsage([entry({ inputTokens: 42 })])).toEqual({ inputTokens: 42 });
  });

  it("sums a single entry with all fields present", () => {
    expect(
      aggregateUsage([
        entry({
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 1000,
          cacheWriteTokens: 200,
          costUsd: 0.12,
        }),
      ])
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 1000,
      cacheWriteTokens: 200,
      costUsd: 0.12,
    });
  });

  it("sums multiple entries across agents", () => {
    expect(
      aggregateUsage([
        entry({
          agent: "claude",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 1000,
          costUsd: 0.1,
        }),
        entry({
          agent: "pullfrog",
          inputTokens: 200,
          outputTokens: 80,
          cacheReadTokens: 2000,
          cacheWriteTokens: 300,
          costUsd: 0.25,
        }),
      ])
    ).toEqual({
      inputTokens: 300,
      outputTokens: 130,
      cacheReadTokens: 3000,
      cacheWriteTokens: 300,
      // floating-point sum — specifying exact value documents expected precision
      costUsd: 0.35,
    });
  });

  it("treats undefined cache/cost as zero and drops when the sum is still zero", () => {
    expect(
      aggregateUsage([
        entry({ inputTokens: 10, outputTokens: 5 }),
        entry({ inputTokens: 20, outputTokens: 15 }),
      ])
    ).toEqual({ inputTokens: 30, outputTokens: 20 });
  });

  it("clamps individual INT fields at INT4_MAX so partial-persist cannot happen", () => {
    // server-side per-field rejection would silently drop the huge column and
    // keep the small ones, producing a row with a NULL for the missing metric.
    // clamping client-side guarantees the wire payload is self-consistent.
    const result = aggregateUsage([
      entry({ inputTokens: 3_000_000_000, outputTokens: 42, cacheReadTokens: 5 }),
    ]);
    expect(result.inputTokens).toBe(2_147_483_647);
    expect(result.outputTokens).toBe(42);
    expect(result.cacheReadTokens).toBe(5);
  });
});

describe("patchWorkflowRunFields", () => {
  const sent = async (fields: WorkflowRunPatch) => {
    apiFetch.mockClear();
    await patchWorkflowRunFields({ runId: 1, apiToken: "token", toolState: {} } as unknown as ToolContext, fields);
    const [call] = apiFetch.mock.calls as unknown as [{ body: string }][];
    return call ? JSON.parse(call[0].body) : undefined;
  };

  it("sends the Codex run fields when set", async () => {
    expect(await sent({ codexSpeed: "fast", codexSubagents: 3, quotaEndPercent: 41.5 })).toMatchObject({
      codexSpeed: "fast", codexSubagents: 3, quotaEndPercent: 41.5,
    });
    // zero is a real count and a real quota reading, not "not reported"
    expect(await sent({ codexSubagents: 0, quotaEndPercent: 0 })).toMatchObject({ codexSubagents: 0, quotaEndPercent: 0 });
  });

  it("drops absent or invalid Codex run fields", async () => {
    const body = await sent({ model: "gpt", codexSpeed: "", codexSubagents: 2.5, quotaEndPercent: 101 });
    expect(body).toMatchObject({ model: "gpt" });
    for (const key of ["codexSpeed", "codexSubagents", "quotaEndPercent"]) expect(body).not.toHaveProperty(key);
    expect(await sent({ codexSubagents: -1, quotaEndPercent: Number.NaN })).toBeUndefined();
  });
});
