// FORK: what this run did, for the comment footer. One short line of the
// numbers a reader glances at, and a collapsed block with the rest.
//
// Counters live at module level so the harness hooks can record events with
// one call and every footer built later can read them synchronously. The
// tokens come from the usage the harness already accumulates on toolState.

import type { DiffCoverageBreakdown } from "./diffCoverage.ts";
import { getDiffCoverageBreakdown } from "./diffCoverage.ts";
import { aggregateUsage } from "./patchWorkflowRunFields.ts";
import type { ToolState } from "../toolState.ts";

const startedAt = Date.now();
const toolCalls = new Map<string, number>();
const subagents: { label: string; seconds: number; status: string }[] = [];

export function recordToolUse(toolName: string): void {
  toolCalls.set(toolName, (toolCalls.get(toolName) ?? 0) + 1);
}

export function recordSubagentFinish(label: string, seconds: number, status: string): void {
  subagents.push({ label, seconds, status });
}

export interface ReviewStats {
  inlineComments: number;
  droppedComments: number;
}

export interface RunStatsInput {
  toolState: ToolState;
  review?: ReviewStats | undefined;
}

export interface RenderedRunStats {
  /** the glance: `6m 40s · 1.2M in · 3.9K out · 2 subagents · read 100% of the diff` */
  line: string;
  /** a collapsed `<details>` block with the breakdown, markdown inside */
  details: string;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function fmtTokens(n: number): string {
  return compact.format(n);
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function coverageOf(toolState: ToolState): DiffCoverageBreakdown | null {
  const repo = toolState.repos.get(toolState.primaryRepoKey);
  const state = repo?.diffCoverage;
  if (!state || !state.totalLines) return null;
  return getDiffCoverageBreakdown({ state });
}

export function renderRunStats(input: RunStatsInput): RenderedRunStats | null {
  const { toolState, review } = input;
  const usage = aggregateUsage(toolState.usageEntries);
  const attempts = toolState.usageEntries.length;
  const elapsed = Date.now() - startedAt;
  const coverage = coverageOf(toolState);
  const totalTools = [...toolCalls.values()].reduce((a, b) => a + b, 0);

  const line: string[] = [fmtDuration(elapsed)];
  if (usage.inputTokens) line.push(`${fmtTokens(usage.inputTokens)} in`);
  if (usage.outputTokens) line.push(`${fmtTokens(usage.outputTokens)} out`);
  if (subagents.length) line.push(`${subagents.length} subagent${subagents.length === 1 ? "" : "s"}`);
  if (coverage) line.push(`read ${Math.round(coverage.coveragePercent)}% of the diff`);

  const rows: string[] = [];
  rows.push(`- Time: ${fmtDuration(elapsed)} from action start to this post`);
  if (usage.inputTokens || usage.outputTokens) {
    const cacheRead = usage.cacheReadTokens ?? 0;
    const hit = usage.inputTokens ? Math.round((cacheRead / usage.inputTokens) * 100) : 0;
    const cost = usage.costUsd && usage.costUsd > 0 ? ` · ≈ $${usage.costUsd.toFixed(2)} at API prices` : "";
    rows.push(
      `- Tokens: ${fmtTokens(usage.inputTokens ?? 0)} in${cacheRead ? ` (${hit}% from cache)` : ""} · ${fmtTokens(usage.outputTokens ?? 0)} out${cost}`
    );
  }
  if (attempts > 1) rows.push(`- Attempts: ${attempts} (the agent was sent back to finish)`);
  if (subagents.length) {
    rows.push(
      `- Subagents: ${subagents.map((s) => `${s.label} ${fmtDuration(s.seconds * 1000)}${s.status === "error" ? " (failed)" : ""}`).join(" · ")}`
    );
  }
  if (totalTools) {
    const top = [...toolCalls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const rest = totalTools - top.reduce((a, [, n]) => a + n, 0);
    rows.push(
      `- Tool calls: ${totalTools} (${top.map(([n, c]) => `${n} ${c}`).join(", ")}${rest > 0 ? `, other ${rest}` : ""})`
    );
  }
  if (coverage) {
    const files = coverage.files
      .slice()
      .sort((a, b) => b.totalLines - a.totalLines)
      .slice(0, 6)
      .map((f) => `${f.filename} ${f.totalLines ? Math.round((f.coveredLines / f.totalLines) * 100) : 100}%`)
      .join(" · ");
    rows.push(
      `- Diff coverage: ${coverage.coveredLines} of ${coverage.totalLines} changed lines read (${Math.round(coverage.coveragePercent)}%)${files ? `; ${files}` : ""}`
    );
  }
  if (review) {
    const dropped = review.droppedComments ? ` (${review.droppedComments} dropped: outside the diff)` : "";
    rows.push(`- Review: ${review.inlineComments} inline comment${review.inlineComments === 1 ? "" : "s"}${dropped}`);
  }

  const details = `<details><summary>Run stats</summary>\n\n${rows.join("\n")}\n\n</details>`;
  return { line: line.join(" · "), details };
}
