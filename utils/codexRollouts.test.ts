import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readSubagentRollouts, readWeeklyLimit } from "./codexRollouts.ts";

const ROOT = "root-thread";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// Shapes recorded from a codex 0.162.1 run with two v2 subagents.
function meta(id: string, session: string, at: string, agentPath?: string) {
  const source = agentPath ? { subagent: { thread_spawn: { parent_thread_id: session, depth: 1, agent_path: agentPath } } } : "exec";
  return { timestamp: at, type: "session_meta", payload: { session_id: session, id, timestamp: at, source } };
}
const event = (at: string, payload: Record<string, unknown>) => ({ timestamp: at, type: "event_msg", payload });
const tokens = (at: string, input: number, cached: number, output: number) =>
  event(at, { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output } } });

function home(rollouts: Record<string, object[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-rollouts-")); dirs.push(dir);
  const day = join(dir, "sessions", "2026", "11", "11");
  mkdirSync(day, { recursive: true });
  for (const [name, lines] of Object.entries(rollouts)) {
    writeFileSync(join(day, `rollout-${name}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }
  return dir;
}

it("reads each subagent of the root session with its label, time, status and tokens", () => {
  const codexHome = home({
    root: [meta(ROOT, ROOT, "2026-11-11T18:08:31.000Z"), tokens("2026-11-11T18:08:50.000Z", 185_000, 150_000, 184)],
    color: [
      meta("child-color", ROOT, "2026-11-11T18:08:36.000Z", "/root/color"),
      event("2026-11-11T18:08:36.500Z", { type: "task_started" }),
      tokens("2026-11-11T18:08:38.000Z", 20_000, 0, 3),
      tokens("2026-11-11T18:08:39.000Z", 25_897, 0, 5),
      event("2026-11-11T18:08:39.500Z", { type: "task_complete" }),
    ],
    nested: [
      meta("child-nested", ROOT, "2026-11-11T18:08:40.000Z", "/root/color/deeper"),
      event("2026-11-11T18:08:40.100Z", { type: "task_started" }),
      tokens("2026-11-11T18:08:41.000Z", 1_000, 500, 2),
      event("2026-11-11T18:08:43.000Z", { type: "agent_message" }),
    ],
    other: [meta("child-other", "other-root", "2026-11-11T18:08:36.000Z", "/root/elsewhere"), event("2026-11-11T18:08:37.000Z", { type: "task_complete" })],
  });

  expect(readSubagentRollouts({ codexHome, rootThreadId: ROOT, since: 0 })).toEqual([
    { id: "child-color", label: "color", seconds: 3.5, status: "completed", tokens: { input: 25_897, cacheRead: 0, cacheWrite: 0, output: 5 } },
    { id: "child-nested", label: "color/deeper", seconds: 3, status: "unfinished", tokens: { input: 1_000, cacheRead: 500, cacheWrite: 0, output: 2 } },
  ]);
});

it("counts a subagent given a follow-up task as unfinished until that task completes", () => {
  const codexHome = home({
    fruit: [
      meta("child-fruit", ROOT, "2026-11-11T18:00:00.000Z", "/root/fruit"),
      event("2026-11-11T18:00:01.000Z", { type: "task_started" }),
      event("2026-11-11T18:00:05.000Z", { type: "task_complete" }),
      event("2026-11-11T18:00:09.000Z", { type: "task_started" }),
    ],
  });
  expect(readSubagentRollouts({ codexHome, rootThreadId: ROOT, since: 0 })).toMatchObject([{ label: "fruit", status: "unfinished", seconds: 9 }]);
});

it("skips rollouts written before the run started, and a missing sessions directory", () => {
  const codexHome = home({ old: [meta("child-old", ROOT, "2026-11-01T00:00:00.000Z", "/root/old"), event("2026-11-01T00:00:01.000Z", { type: "task_complete" })] });
  const file = join(codexHome, "sessions", "2026", "11", "11", "rollout-old.jsonl");
  utimesSync(file, new Date("2026-11-01T00:00:02Z"), new Date("2026-11-01T00:00:02Z"));
  expect(readSubagentRollouts({ codexHome, rootThreadId: ROOT, since: Date.parse("2026-11-11T00:00:00Z") })).toEqual([]);
  expect(readSubagentRollouts({ codexHome: join(codexHome, "absent"), rootThreadId: ROOT, since: 0 })).toEqual([]);
});

it("reads the newest weekly limit any thread of the session reported", () => {
  const limits = (week: number, fiveHour?: number) => ({
    primary: fiveHour === undefined ? { used_percent: week, window_minutes: 10_080, resets_at: 1_794_667_348 } : { used_percent: fiveHour, window_minutes: 300, resets_at: 1 },
    secondary: fiveHour === undefined ? null : { used_percent: week, window_minutes: 10_080, resets_at: 1_794_667_348 },
    plan_type: "pro",
  });
  const counted = (at: string, rateLimits: object) =>
    event(at, { type: "token_count", info: { total_token_usage: { input_tokens: 1, output_tokens: 1 } }, rate_limits: rateLimits });
  const codexHome = home({
    root: [meta(ROOT, ROOT, "2026-11-11T18:00:00.000Z"), counted("2026-11-11T18:00:10.000Z", limits(40)), counted("2026-11-11T18:00:30.000Z", limits(44))],
    child: [meta("child", ROOT, "2026-11-11T18:00:05.000Z", "/root/area"), counted("2026-11-11T18:00:20.000Z", limits(43, 90))],
    other: [meta("x", "other-root", "2026-11-11T18:00:00.000Z"), counted("2026-11-11T19:00:00.000Z", limits(99))],
  });
  expect(readWeeklyLimit({ codexHome, rootThreadId: ROOT, since: 0 })).toEqual({ plan: "pro", usedPercent: 44, windowSeconds: 604_800, resetAt: 1_794_667_348 });

  const childNewest = home({
    root: [meta(ROOT, ROOT, "2026-11-11T18:00:00.000Z"), counted("2026-11-11T18:00:10.000Z", limits(40))],
    child: [meta("child", ROOT, "2026-11-11T18:00:05.000Z", "/root/area"), counted("2026-11-11T18:00:20.000Z", limits(43, 90))],
  });
  expect(readWeeklyLimit({ codexHome: childNewest, rootThreadId: ROOT, since: 0 })).toMatchObject({ usedPercent: 43 });
  expect(readWeeklyLimit({ codexHome: home({ root: [meta(ROOT, ROOT, "2026-11-11T18:00:00.000Z")] }), rootThreadId: ROOT, since: 0 })).toBeNull();
});
