import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { codex } from "./codex.ts";
import { log } from "../utils/cli.ts";
import { initToolState } from "../toolState.ts";
import { currentCodexUsage } from "../utils/codexUsage.ts";
import { renderRunStats } from "../utils/runStats.ts";
import type { AgentRunContext } from "./shared.ts";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), codexHome: vi.fn(), usage: vi.fn(), resumed: undefined as unknown }));
// the weekly limit the run's login reports; most tests run with plenty left
vi.mock("../utils/codexUsage.ts", async (original) => ({ ...await original<typeof import("../utils/codexUsage.ts")>(), primeCodexUsage: mocks.usage }));
vi.mock("../utils/install.ts", () => ({ installFromNpmTarball: async () => "/fixture/codex" }));
vi.mock("../utils/codexHome.ts", () => ({ installCodexHome: mocks.codexHome }));
vi.mock("../utils/codexPool.ts", () => ({ registerCodexPoolAuth: () => false, markCodexPoolChild: () => {} }));
vi.mock("../utils/skills.ts", () => ({ installBundledSkills: () => {} }));
vi.mock("../utils/subprocess.ts", async (original) => ({ ...await original<typeof import("../utils/subprocess.ts")>(), spawn: mocks.spawn }));
vi.mock("./postRun.ts", () => ({
  buildReflectionPrompt: () => "Check local changes",
  runPostRunRetryLoop: async ({ initialResult, resume }: { initialResult: unknown; resume: (args: unknown) => Promise<unknown> }) => {
    mocks.resumed = await resume({ previousResult: { threadId: "fixture-thread" }, prompt: "Finish the local commit" });
    return initialResult;
  },
}));

const dirs: string[] = [];
beforeEach(() => { mocks.usage.mockResolvedValue({ plan: "pro", usedPercent: 50, windowSeconds: 604_800, resetAt: 0 }); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it.each([
  ["pull_request_merged", "disabled", "workspace-write"],
  ["pull_request", "disabled", "read-only"],
  ["pull_request", "enabled", "workspace-write"],
])("configures %s with push=%s as %s for initial and resumed turns", async (trigger, push, sandbox) => {
  const dir = mkdtempSync(join(tmpdir(), "codex-config-test-")); dirs.push(dir);
  mocks.spawn.mockResolvedValue({ exitCode: 0 });
  const ctx = {
    payload: { event: { trigger }, push, shell: "restricted" },
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Update documentation" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext;
  await codex.run(ctx);
  const config = readFileSync(join(dir, ".codex", "config.toml"), "utf8");
  expect(config).toContain(`sandbox_mode = "${sandbox}"`);
  expect(config).toContain('approval_policy = "never"');
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  for (const [{ args }] of mocks.spawn.mock.calls) {
    expect(args).toContain(`sandbox_mode="${sandbox}"`);
    expect(args).toContain("features.shell_tool=false");
  }
  expect(ctx.payload.push).toBe(push);
});

const catalog = (tiers: string[]) => JSON.stringify({ models: [{ slug: "gpt-6.1-sol", additional_speed_tiers: tiers }] });

it.each([
  // setting, legacy env flag, catalog tiers (null = unreadable), applied tier
  [undefined, undefined, ["fast", "ultrafast"], undefined],
  [undefined, "1", ["fast"], "fast"],
  ["standard", "1", ["fast"], undefined],
  ["fast", undefined, ["fast", "ultrafast"], "fast"],
  ["fast", undefined, [], undefined],
  ["ultrafast", undefined, ["fast", "ultrafast"], "ultrafast"],
  ["ultrafast", undefined, ["fast"], "fast"],
  ["ultrafast", undefined, [], undefined],
  ["ultrafast", undefined, null, "fast"],
])("speed setting %s with env %s and catalog %j applies %s", async (setting, flag, tiers, applied) => {
  vi.stubEnv("PULLFROG_CODEX_FAST_MODE", flag);
  const dir = mkdtempSync(join(tmpdir(), "codex-speed-test-")); dirs.push(dir);
  const codexHome = join(dir, ".codex");
  mocks.codexHome.mockReturnValue({ codexHome, authPath: join(codexHome, "auth.json"), originalRefresh: "fixture" });
  mocks.spawn.mockImplementation(async ({ args }: { args: string[] }) =>
    args[0] === "debug" ? { exitCode: tiers ? 0 : 1, stdout: tiers ? catalog(tiers) : "" } : { exitCode: 0 });
  const ctx = {
    payload: { event: { trigger: "pull_request_opened" }, push: "disabled", shell: "restricted", effort: 0.5 },
    resolvedModel: "openai/gpt-6.1-sol", codexSpeed: setting,
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext;

  await codex.run(ctx);

  const features = applied === "ultrafast" ? ["fast_mode", "ultrafast_mode"] : applied ? ["fast_mode"] : [];
  const config = readFileSync(join(codexHome, "config.toml"), "utf8");
  expect(config.match(/^service_tier = .*$/m)?.[0]).toBe(applied && `service_tier = "${applied}"`);
  for (const name of ["fast_mode", "ultrafast_mode"]) expect(config.includes(`${name} = true`)).toBe(features.includes(name));
  expect(config).toContain('model = "gpt-6.1-sol"');
  expect(config).toContain('model_reasoning_effort = "high"');
  const calls = mocks.spawn.mock.calls.map(([options]) => options);
  const catalogReads = calls.filter(({ args }) => args[0] === "debug");
  const turns = calls.filter(({ args }) => args[0] !== "debug");
  expect(catalogReads).toHaveLength(setting === "standard" || (!setting && !flag) ? 0 : 1);
  for (const { args, env } of catalogReads) {
    expect(env.CODEX_HOME).toBe(codexHome);
    expect(args).toContain("features.daemon_auto_start=false");
  }
  expect(turns).toHaveLength(2);
  for (const { args, env } of turns) {
    expect(env.CODEX_HOME).toBe(codexHome);
    expect(args.find((arg: string) => arg.startsWith("service_tier="))).toBe(applied && `service_tier="${applied}"`);
    for (const name of ["fast_mode", "ultrafast_mode"]) expect(args.includes(`features.${name}=true`)).toBe(features.includes(name));
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).toContain("features.shell_tool=false");
  }
  expect(turns[1]!.args).toContain("resume");
});

it("passes the requested tier through on an API-key run, which has no plan catalog to read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-speed-test-")); dirs.push(dir);
  mocks.spawn.mockResolvedValue({ exitCode: 0 });
  await codex.run({
    payload: { event: { trigger: "pull_request_opened" }, push: "disabled", shell: "restricted" },
    resolvedModel: "openai/gpt-6.1-sol", codexSpeed: "ultrafast",
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  for (const [{ args }] of mocks.spawn.mock.calls) expect(args).toContain('service_tier="ultrafast"');
});

// A run's classification, not its PR association or prompt text, decides speed.
it.each([
  ["review", "issue_comment_created", "ultrafast"],
  ["incremental_review", "pull_request_synchronize", "ultrafast"],
  ["docs_update", "pull_request_merged", undefined],
  ["task", "issue_comment_created", undefined],
  ["task", "pull_request_opened", undefined],
  ["future_task", "pull_request_opened", undefined],
  [undefined, "issue_comment_created", undefined],
  [undefined, "workflow_dispatch", undefined],
  [undefined, "unknown", undefined],
])("run type %s and trigger %s apply %s on initial and resumed turns", async (type, trigger, applied) => {
  vi.stubEnv("PULLFROG_CODEX_FAST_MODE", "1");
  const dir = mkdtempSync(join(tmpdir(), "codex-run-speed-test-")); dirs.push(dir);
  const codexHome = join(dir, ".codex");
  mocks.codexHome.mockReturnValue({ codexHome, authPath: join(codexHome, "auth.json"), originalRefresh: "fixture" });
  mocks.spawn.mockImplementation(async ({ args }: { args: string[] }) =>
    args[0] === "debug" ? { exitCode: 0, stdout: catalog(["fast", "ultrafast"]) } : { exitCode: 0 });
  const toolState = {} as AgentRunContext["toolState"];
  await codex.run({
    payload: { type, event: { trigger, is_pr: true }, push: "disabled", shell: "restricted", effort: 0.5 },
    resolvedModel: "openai/gpt-6.1-sol", codexSpeed: "ultrafast",
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review or update the docs" },
    toolState, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  // the applied tier is what the end-of-run PATCH reports
  expect(toolState.codexSpeed).toBe(applied ?? "standard");
  const config = readFileSync(join(codexHome, "config.toml"), "utf8");
  expect(config.match(/^service_tier = .*$/m)?.[0]).toBe(applied && `service_tier = "${applied}"`);
  expect(config).toContain('model_reasoning_effort = "high"');
  const calls = mocks.spawn.mock.calls.map(([options]) => options);
  expect(calls.filter(({ args }) => args[0] === "debug")).toHaveLength(applied ? 1 : 0);
  const turns = calls.filter(({ args }) => args[0] !== "debug");
  expect(turns).toHaveLength(2);
  expect(turns[1]!.args).toContain("resume");
  for (const { args } of turns) {
    expect(args.find((arg: string) => arg.startsWith("service_tier="))).toBe(applied && `service_tier="${applied}"`);
    expect(args.includes("features.fast_mode=true")).toBe(Boolean(applied));
    expect(args.includes("features.ultrafast_mode=true")).toBe(Boolean(applied));
  }
});

// Review runs get v2 subagents pinned to the lead's model; every other run keeps them off.
it.each([
  ["review", "pull_request_opened", true],
  ["incremental_review", "pull_request_synchronize", true],
  ["task", "issue_comment_created", false],
  ["docs_update", "pull_request_merged", false],
])("run type %s on %s enables subagents: %s", async (type, trigger, enabled) => {
  const dir = mkdtempSync(join(tmpdir(), "codex-subagent-test-")); dirs.push(dir);
  mocks.spawn.mockResolvedValue({ exitCode: 0 });
  await codex.run({
    payload: { type, event: { trigger }, push: "disabled", shell: "restricted" },
    resolvedModel: "openai/gpt-6.1-sol",
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  const config = readFileSync(join(dir, ".codex", "config.toml"), "utf8");
  expect(config).toContain("multi_agent = false");
  const v2 = config.match(/^multi_agent_v2 = (.*)$/m)?.[1];
  const agents = ['default_subagent_model = "gpt-6.1-sol"', 'default_subagent_reasoning_effort = "medium"', "max_concurrent_threads_per_session = 16"];
  if (enabled) {
    expect(v2).toMatch(/^\{ enabled = true, max_wait_timeout_ms = 600000, default_wait_timeout_ms = 120000, expose_spawn_agent_model_overrides = false, subagent_developer_instructions = "You are a subagent.*Never spawn agents\..*" \}$/);
    expect(config).toContain(["[agents]", ...agents].join("\n"));
  } else {
    expect(v2).toBe("false");
    expect(config).not.toContain("[agents]");
  }
  const turns = mocks.spawn.mock.calls.map(([options]) => options.args as string[]);
  expect(turns).toHaveLength(2);
  for (const args of turns) {
    expect(args).toContain("features.multi_agent=false");
    expect(args).toContain(`features.multi_agent_v2=${v2}`);
    for (const entry of agents) expect(args.includes(`agents.${entry.replace(" = ", "=")}`)).toBe(enabled);
  }
});

// Subagents never appear in the exec stream; their rollouts are the record.
it("adds subagent tokens from rollouts to each exec's usage, warns once about lost work, and feeds the footer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-subagent-usage-")); dirs.push(dir);
  const day = join(dir, ".codex", "sessions", "2026", "11", "11");
  // strictly increasing, so "newest" is the last line written
  let tick = 0;
  const at = () => new Date(Date.parse("2026-11-11T18:00:00Z") + 1000 * tick++).toISOString();
  // rollouts are append-only JSONL, one complete line per record
  const append = (name: string, ...records: object[]) =>
    appendFileSync(join(day, `rollout-${name}.jsonl`), records.map((record) => `${JSON.stringify(record)}\n`).join(""));
  const start = (name: string) => append(name,
    { type: "session_meta", payload: { id: `child-${name}`, session_id: "root", timestamp: at(), source: { subagent: { thread_spawn: { agent_path: `/root/${name}` } } } } },
    { timestamp: at(), type: "event_msg", payload: { type: "task_started" } });
  const tokens = (name: string, input: number, output: number) => append(name,
    { timestamp: at(), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output } }, rate_limits: { primary: { used_percent: 40 + output, window_minutes: 10_080, resets_at: 1 } } } });
  const done = (name: string) => append(name, { timestamp: at(), type: "event_msg", payload: { type: "task_complete" } });
  const warning = vi.spyOn(log, "warning");
  mocks.spawn.mockImplementation(async ({ args, onStdout }: { args: string[]; onStdout: (chunk: string) => void }) => {
    mkdirSync(day, { recursive: true });
    if (args.includes("resume")) { tokens("fruit", 5_000, 4); start("lime"); tokens("lime", 1_000, 1); done("lime"); }
    else { start("color"); tokens("color", 20_000, 5); done("color"); start("fruit"); tokens("fruit", 3_000, 2); }
    onStdout(`${JSON.stringify({ type: "thread.started", thread_id: "root" })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1_000, cached_input_tokens: 0, output_tokens: 100 } })}\n`);
    return { exitCode: 0 };
  });
  const toolState = initToolState({ owner: "o", name: "r", dir, progressComment: undefined });
  const result = await codex.run({
    payload: { type: "review", event: { trigger: "pull_request_opened" }, push: "disabled", shell: "restricted" },
    resolvedModel: "openai/gpt-6.1-sol",
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);

  expect(result.usage).toMatchObject({ inputTokens: 24_000, outputTokens: 107 });
  // the resume adds only what changed since: fruit +2,000/+2 and the new lime 1,000/1
  expect(mocks.resumed).toMatchObject({ usage: { inputTokens: 4_000, outputTokens: 103 } });
  const lost = warning.mock.calls.filter(([message]) => String(message).includes("still working"));
  expect(lost).toEqual([["» 1 subagent(s) were still working when codex exited; their work is lost: fruit"]]);
  const stats = renderRunStats({ toolState })!;
  expect(stats.line).toContain("3 subagents");
  // fruit spans both execs but counts once: the run total the end-of-run PATCH reports
  expect(toolState.codexSubagents).toBe(3);
  // the footer's weekly limit is the session's newest report, not the early read
  expect(currentCodexUsage()).toMatchObject({ usedPercent: 41 });
  expect(stats.details).toMatch(/- Subagents: 3 \(26K in · 10 out\): color \d+s · fruit \d+s \(unfinished\) · lime \d+s\n/);
});

// The repo's codex.subagents.* settings reach the config; 0 turns subagents off.
it.each([
  [{ max: 40, effort: "high" }, ["default_subagent_reasoning_effort = \"high\"", "max_concurrent_threads_per_session = 40"]],
  [{ max: 0, effort: "high" }, null],
])("review subagent limits %j", async (reviewSubagents, agents) => {
  const dir = mkdtempSync(join(tmpdir(), "codex-subagent-limits-")); dirs.push(dir);
  mocks.spawn.mockResolvedValue({ exitCode: 0 });
  await codex.run({
    payload: { type: "review", event: { trigger: "pull_request_opened" }, push: "disabled", shell: "restricted" },
    resolvedModel: "openai/gpt-6.1-sol", reviewSubagents,
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  const config = readFileSync(join(dir, ".codex", "config.toml"), "utf8");
  const turns = mocks.spawn.mock.calls.map(([options]) => options.args as string[]);
  if (agents) {
    for (const entry of agents) expect(config).toContain(entry);
    for (const args of turns) for (const entry of agents) expect(args).toContain(`agents.${entry.replace(" = ", "=")}`);
  } else {
    expect(config).toMatch(/^multi_agent_v2 = false$/m);
    expect(config).not.toContain("[agents]");
    for (const args of turns) expect(args).toContain("features.multi_agent_v2=false");
  }
});

// codex.speed.fallback_below: Ultrafast runs at Fast when the weekly limit is low or unknown.
it.each([
  [{ usedPercent: 50 }, undefined, "ultrafast"],
  [{ usedPercent: 95 }, undefined, "fast"],
  [{ usedPercent: 85 }, 20, "fast"],
  [{ usedPercent: 85 }, 10, "ultrafast"],
  [null, undefined, "fast"],
  [null, 0, "ultrafast"],
])("weekly usage %j with fallback %s applies %s", async (usage, fallbackBelow, applied) => {
  mocks.usage.mockResolvedValue(usage && { plan: "pro", windowSeconds: 604_800, resetAt: 0, ...usage });
  const dir = mkdtempSync(join(tmpdir(), "codex-speed-fallback-")); dirs.push(dir);
  const codexHome = join(dir, ".codex");
  mocks.codexHome.mockReturnValue({ codexHome, authPath: join(codexHome, "auth.json"), originalRefresh: "fixture" });
  mocks.spawn.mockImplementation(async ({ args }: { args: string[] }) =>
    args[0] === "debug" ? { exitCode: 0, stdout: catalog(["fast", "ultrafast"]) } : { exitCode: 0 });
  await codex.run({
    payload: { type: "review", event: { trigger: "pull_request_opened" }, push: "disabled", shell: "restricted" },
    resolvedModel: "openai/gpt-6.1-sol", codexSpeed: "ultrafast", codexSpeedFallbackBelow: fallbackBelow,
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  const turns = mocks.spawn.mock.calls.map(([options]) => options.args as string[]).filter((args) => args[0] !== "debug");
  expect(turns).toHaveLength(2);
  for (const args of turns) expect(args).toContain(`service_tier="${applied}"`);
});

// A repo that leaves its model unset runs on Codex's default model; the cap still applies.
it.each([
  [{ usedPercent: 95 }, "fast"],
  [null, "fast"],
  [{ usedPercent: 50 }, "ultrafast"],
])("on Codex's default model, weekly usage %j applies %s", async (usage, applied) => {
  mocks.usage.mockResolvedValue(usage && { plan: "pro", windowSeconds: 604_800, resetAt: 0, ...usage });
  const dir = mkdtempSync(join(tmpdir(), "codex-speed-default-model-")); dirs.push(dir);
  const codexHome = join(dir, ".codex");
  mocks.codexHome.mockReturnValue({ codexHome, authPath: join(codexHome, "auth.json"), originalRefresh: "fixture" });
  mocks.spawn.mockResolvedValue({ exitCode: 0 });
  await codex.run({
    payload: { type: "review", event: { trigger: "pull_request_opened" }, push: "disabled", shell: "restricted" },
    codexSpeed: "ultrafast",
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  expect(mocks.usage).toHaveBeenCalledOnce();
  const turns = mocks.spawn.mock.calls.map(([options]) => options.args as string[]);
  expect(turns).toHaveLength(2);
  expect(turns[1]).toContain("resume");
  for (const args of turns) expect(args).toContain(`service_tier="${applied}"`);
});

it("never reads the weekly limit on an API-key run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-speed-apikey-")); dirs.push(dir);
  mocks.spawn.mockResolvedValue({ exitCode: 0 });
  await codex.run({
    payload: { type: "review", event: { trigger: "pull_request_opened" }, push: "disabled", shell: "restricted" },
    resolvedModel: "openai/gpt-6.1-sol", codexSpeed: "ultrafast",
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  expect(mocks.usage).not.toHaveBeenCalled();
  for (const [{ args }] of mocks.spawn.mock.calls) expect(args).toContain('service_tier="ultrafast"');
});
