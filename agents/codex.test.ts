import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { codex } from "./codex.ts";
import type { AgentRunContext } from "./shared.ts";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("../utils/install.ts", () => ({ installFromNpmTarball: async () => "/fixture/codex" }));
vi.mock("../utils/codexHome.ts", () => ({ installCodexHome: () => undefined }));
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
afterEach(() => { vi.clearAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

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
