import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { codex } from "./codex.ts";
import type { AgentRunContext } from "./shared.ts";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), codexHome: vi.fn() }));
vi.mock("../utils/install.ts", () => ({ installFromNpmTarball: async () => "/fixture/codex" }));
vi.mock("../utils/codexHome.ts", () => ({ installCodexHome: mocks.codexHome }));
vi.mock("../utils/codexPool.ts", () => ({ registerCodexPoolAuth: () => false, markCodexPoolChild: () => {} }));
vi.mock("../utils/skills.ts", () => ({ installBundledSkills: () => {} }));
vi.mock("../utils/subprocess.ts", async (original) => ({ ...await original<typeof import("../utils/subprocess.ts")>(), spawn: mocks.spawn }));
vi.mock("./postRun.ts", () => ({
  buildReflectionPrompt: () => "Check local changes",
  runPostRunRetryLoop: async ({ initialResult, resume }: { initialResult: unknown; resume: (args: unknown) => Promise<unknown> }) => {
    await resume({ previousResult: { threadId: "fixture-thread" }, prompt: "Finish the local commit" });
    return initialResult;
  },
}));

const dirs: string[] = [];
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
    payload: { event: { trigger: "pull_request" }, push: "disabled", shell: "restricted", effort: 0.5 },
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
    payload: { event: { trigger: "pull_request" }, push: "disabled", shell: "restricted" },
    resolvedModel: "openai/gpt-6.1-sol", codexSpeed: "ultrafast",
    tmpdir: dir, mcpServerUrl: "http://localhost:9999/mcp", instructions: { full: "Review the changes" },
    toolState: {}, apiToken: "", subagentDeniedTools: [],
  } as unknown as AgentRunContext);
  for (const [{ args }] of mocks.spawn.mock.calls) expect(args).toContain('service_tier="ultrafast"');
});
