// FORK: Codex session accounting. `codex exec --json` streams only the root
// thread: spawns never appear, `wait` items carry no thread ids, and token
// usage is the root's alone. Every thread writes its own rollout under
// `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, and those files are the
// record this module reads: subagent time, status and tokens, and the
// subscription's rate limits as the backend reported them on each turn.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CodexUsage } from "./codexUsage.ts";

export type SubagentTokens = { input: number; cacheRead: number; cacheWrite: number; output: number };

export type SubagentRollout = {
  /** the subagent's thread id */
  id: string;
  /** spawn_agent's `task_name`, e.g. `color` for agent path `/root/color` */
  label: string;
  seconds: number;
  /** `completed` when its last task finished; `unfinished` when it was still working */
  status: "completed" | "unfinished";
  tokens: SubagentTokens;
};

function rolloutFiles(dir: string, since: number): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rolloutFiles(path, since);
    return entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl") && statSync(path).mtimeMs >= since ? [path] : [];
  });
}

type RolloutMeta = {
  id?: string;
  session_id?: string;
  timestamp?: string;
  source?: { subagent?: { thread_spawn?: { agent_path?: string } } };
};

type RateLimitWindow = { used_percent?: number; window_minutes?: number; resets_at?: number };
type WeeklyLimit = { at: number; usage: CodexUsage };

/** the weekly window of a `token_count` line's `rate_limits`, as `/wham/usage` reports it */
function weeklyWindow(limits: unknown, at: number): WeeklyLimit | undefined {
  const { primary, secondary, plan_type: plan } = (limits ?? {}) as { primary?: RateLimitWindow | null; secondary?: RateLimitWindow | null; plan_type?: string };
  const week = [primary, secondary].find((w) => w && typeof w.used_percent === "number" && (w.window_minutes ?? 0) >= 6 * 1440 && (w.window_minutes ?? 0) <= 8 * 1440);
  if (!week || !Number.isFinite(at)) return undefined;
  return { at, usage: { plan, usedPercent: week.used_percent!, windowSeconds: week.window_minutes! * 60, resetAt: week.resets_at ?? 0 } };
}

type ParsedRollout = { subagent: SubagentRollout | null; weekly: WeeklyLimit | undefined };

function parseRollout(path: string, rootThreadId: string): ParsedRollout | null {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  let meta: RolloutMeta | undefined;
  let lastTask: "task_started" | "task_complete" | undefined;
  let endedAt: string | undefined;
  let lastTimestamp: string | undefined;
  let usage: Record<string, number> | undefined;
  let weekly: WeeklyLimit | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: { type?: string; timestamp?: string; payload?: Record<string, unknown> };
    try { record = JSON.parse(line); } catch { continue; }
    if (!meta) {
      if (record.type !== "session_meta") return null;
      meta = record.payload as RolloutMeta;
      if (meta.session_id !== rootThreadId) return null;
      continue;
    }
    lastTimestamp = record.timestamp ?? lastTimestamp;
    const payload = record.payload ?? {};
    if (record.type !== "event_msg") continue;
    if (payload.type === "task_started") lastTask = "task_started";
    if (payload.type === "task_complete") { lastTask = "task_complete"; endedAt = record.timestamp; }
    if (payload.type === "token_count") {
      const total = (payload.info as { total_token_usage?: Record<string, number> } | null)?.total_token_usage;
      if (total) usage = total;
      weekly = weeklyWindow(payload.rate_limits, Date.parse(record.timestamp ?? "")) ?? weekly;
    }
  }
  if (!meta?.id) return null;
  if (meta.id === rootThreadId || !meta.source?.subagent) return { subagent: null, weekly };
  const status = lastTask === "task_complete" ? "completed" : "unfinished";
  const end = status === "completed" ? endedAt : lastTimestamp;
  const start = Date.parse(meta.timestamp ?? "");
  const seconds = end && Number.isFinite(start) ? Math.max(0, (Date.parse(end) - start) / 1000) : 0;
  const agentPath = meta.source?.subagent?.thread_spawn?.agent_path ?? "";
  const subagent: SubagentRollout = {
    id: meta.id,
    label: agentPath.split("/").filter(Boolean).slice(1).join("/") || meta.id.slice(-6),
    seconds,
    status,
    tokens: {
      input: usage?.input_tokens ?? 0,
      cacheRead: usage?.cached_input_tokens ?? 0,
      cacheWrite: usage?.cache_write_input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
    },
  };
  return { subagent, weekly };
}

function sessionRollouts(params: { codexHome: string; rootThreadId: string; since: number }): ParsedRollout[] {
  return rolloutFiles(join(params.codexHome, "sessions"), params.since)
    .map((path) => parseRollout(path, params.rootThreadId))
    .filter((rollout): rollout is ParsedRollout => rollout !== null);
}

/**
 * Every subagent (at any depth) of the Codex session rooted at
 * `rootThreadId`, read from rollouts written at or after `since` (epoch ms).
 */
export function readSubagentRollouts(params: { codexHome: string; rootThreadId: string; since: number }): SubagentRollout[] {
  return sessionRollouts(params)
    .flatMap(({ subagent }) => (subagent ? [subagent] : []))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The newest weekly limit any thread of the session reported, or null before the first turn ends. */
export function readWeeklyLimit(params: { codexHome: string; rootThreadId: string; since: number }): CodexUsage | null {
  let newest: WeeklyLimit | undefined;
  for (const { weekly } of sessionRollouts(params)) if (weekly && (!newest || weekly.at > newest.at)) newest = weekly;
  return newest?.usage ?? null;
}
