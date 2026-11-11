// FORK: Codex session accounting. `codex exec --json` streams only the root
// thread: spawns never appear, `wait` items carry no thread ids, and token
// usage is the root's alone. Every thread writes its own rollout under
// `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, and those files are the
// record this module reads: subagent time, status and tokens, and the
// subscription's rate limits as the backend reported them on each turn.

import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { log } from "./cli.ts";
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

function rolloutFiles(dir: string, since: number): { path: string; size: number }[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rolloutFiles(path, since);
    if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) return [];
    try {
      const stat = statSync(path);
      return stat.mtimeMs >= since ? [{ path, size: stat.size }] : [];
    } catch {
      return [];
    }
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

/** What one rollout has said so far, and how far into the file that covers. */
type RolloutState = {
  rootThreadId: string;
  /** bytes consumed: always the end of a complete line */
  offset: number;
  /** another session's rollout, or not a rollout at all */
  foreign: boolean;
  meta?: RolloutMeta | undefined;
  lastTask?: "task_started" | "task_complete" | undefined;
  endedAt?: string | undefined;
  lastTimestamp?: string | undefined;
  usage?: Record<string, number> | undefined;
  weekly?: WeeklyLimit | undefined;
};

// Rollouts only grow, and the lead's holds every diff page it read (MBs), so
// each footer build parses only the lines appended since the previous one.
const states = new Map<string, RolloutState>();

function readAppended(path: string, from: number, to: number): Buffer {
  const buffer = Buffer.alloc(to - from);
  const fd = openSync(path, "r");
  try {
    let read = 0;
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, from + read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

function updateRollout(path: string, size: number, rootThreadId: string): RolloutState {
  let state = states.get(path);
  if (!state || state.rootThreadId !== rootThreadId || size < state.offset) {
    state = { rootThreadId, offset: 0, foreign: false };
    states.set(path, state);
  }
  if (state.foreign || size === state.offset) return state;
  const chunk = readAppended(path, state.offset, size);
  const complete = chunk.lastIndexOf(0x0a) + 1;
  state.offset += complete;
  for (const line of chunk.subarray(0, complete).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let record: { type?: string; timestamp?: string; payload?: Record<string, unknown> };
    try { record = JSON.parse(line); } catch { continue; }
    if (!state.meta) {
      state.meta = record.payload as RolloutMeta;
      state.foreign = record.type !== "session_meta" || state.meta?.session_id !== rootThreadId;
      if (state.foreign) return state;
      continue;
    }
    state.lastTimestamp = record.timestamp ?? state.lastTimestamp;
    const payload = record.payload ?? {};
    if (record.type !== "event_msg") continue;
    if (payload.type === "task_started") state.lastTask = "task_started";
    if (payload.type === "task_complete") { state.lastTask = "task_complete"; state.endedAt = record.timestamp; }
    if (payload.type === "token_count") {
      const total = (payload.info as { total_token_usage?: Record<string, number> } | null)?.total_token_usage;
      if (total) state.usage = total;
      state.weekly = weeklyWindow(payload.rate_limits, Date.parse(record.timestamp ?? "")) ?? state.weekly;
    }
  }
  return state;
}

function toSubagent(state: RolloutState): SubagentRollout | null {
  const { meta } = state;
  if (state.foreign || !meta?.id || meta.id === state.rootThreadId || !meta.source?.subagent) return null;
  const status = state.lastTask === "task_complete" ? "completed" : "unfinished";
  const end = status === "completed" ? state.endedAt : state.lastTimestamp;
  const start = Date.parse(meta.timestamp ?? "");
  const seconds = end && Number.isFinite(start) ? Math.max(0, (Date.parse(end) - start) / 1000) : 0;
  const agentPath = meta.source.subagent.thread_spawn?.agent_path ?? "";
  return {
    id: meta.id,
    label: agentPath.split("/").filter(Boolean).slice(1).join("/") || meta.id.slice(-6),
    seconds,
    status,
    tokens: {
      input: state.usage?.input_tokens ?? 0,
      cacheRead: state.usage?.cached_input_tokens ?? 0,
      cacheWrite: state.usage?.cache_write_input_tokens ?? 0,
      output: state.usage?.output_tokens ?? 0,
    },
  };
}

/** this session's rollouts; a file that fails to read is skipped, never thrown, because footers call this */
function sessionRollouts(params: { codexHome: string; rootThreadId: string; since: number }): RolloutState[] {
  return rolloutFiles(join(params.codexHome, "sessions"), params.since).flatMap(({ path, size }) => {
    try {
      const state = updateRollout(path, size, params.rootThreadId);
      return state.foreign || !state.meta ? [] : [state];
    } catch (error) {
      log.debug(`» codex rollout ${path} unreadable: ${error instanceof Error ? error.message : String(error)}`);
      states.delete(path);
      return [];
    }
  });
}

/**
 * Every subagent (at any depth) of the Codex session rooted at
 * `rootThreadId`, read from rollouts written at or after `since` (epoch ms).
 */
export function readSubagentRollouts(params: { codexHome: string; rootThreadId: string; since: number }): SubagentRollout[] {
  return sessionRollouts(params)
    .flatMap((state) => toSubagent(state) ?? [])
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The newest weekly limit any thread of the session reported, or null before the first turn ends. */
export function readWeeklyLimit(params: { codexHome: string; rootThreadId: string; since: number }): CodexUsage | null {
  let newest: WeeklyLimit | undefined;
  for (const { weekly } of sessionRollouts(params)) if (weekly && (!newest || weekly.at > newest.at)) newest = weekly;
  return newest?.usage ?? null;
}
