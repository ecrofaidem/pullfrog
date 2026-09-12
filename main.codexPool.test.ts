import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "./main.ts";

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  model: "openai/gpt-5",
  installOpenCode: vi.fn(), installCodexAuth: vi.fn(), captureModels: vi.fn(), outputs: vi.fn(),
  resolveTokens: vi.fn(),
}));
vi.mock("./utils/runContextData.ts", () => ({ resolveRunContextData: async () => mocks.context }));
vi.mock("./utils/payload.ts", async (original) => ({
  ...await original<typeof import("./utils/payload.ts")>(),
  resolvePromptInput: () => "Review this PR",
  resolvePayload: () => ({ model: mocks.model, event: {}, prompt: "Review this PR" }),
}));
vi.mock("./utils/token.ts", async (original) => ({
  ...await original<typeof import("./utils/token.ts")>(), getJobToken: () => "fixture-job", resolveTokens: mocks.resolveTokens,
}));
vi.mock("./utils/gitAuth.ts", async (original) => ({ ...await original<typeof import("./utils/gitAuth.ts")>(), resolveGit: () => {} }));
vi.mock("./utils/runLifecycle.ts", async (original) => ({ ...await original<typeof import("./utils/runLifecycle.ts")>(), writeRunErrorOutputs: mocks.outputs }));
vi.mock("./agents/index.ts", () => ({ agents: { codex: { name: "codex" }, opencode: { name: "opencode", install: mocks.installOpenCode } } }));
vi.mock("./utils/codexHome.ts", async (original) => ({
  ...await original<typeof import("./utils/codexHome.ts")>(), installCodexAuth: mocks.installCodexAuth, installXaiAuth: mocks.installCodexAuth,
}));
vi.mock("./utils/openCodeModels.ts", async (original) => ({
  ...await original<typeof import("./utils/openCodeModels.ts")>(), captureBaselineModels: mocks.captureModels, captureAuthorizedModels: mocks.captureModels,
}));
vi.mock("./utils/codexUsage.ts", async (original) => ({ ...await original<typeof import("./utils/codexUsage.ts")>(), primeCodexUsage: vi.fn() }));
vi.mock("./utils/normalizeEnv.ts", async (original) => ({ ...await original<typeof import("./utils/normalizeEnv.ts")>(), normalizeEnv: () => {} }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ["CODEX_AUTH_JSON", "CODEX_API_KEY", "OPENAI_API_KEY", "PULLFROG_AGENT", "UNSAFE_OVERRIDES"]) vi.stubEnv(key, "");
  mocks.context = { repo: { owner: "owner", name: "repo", data: {} }, repoSettings: { codexAgent: true }, apiToken: "api", oss: false, plan: "none" };
  mocks.model = "openai/gpt-5";
  mocks.installOpenCode.mockRejectedValue(new Error("unexpected OpenCode installation"));
  mocks.resolveTokens.mockResolvedValue({ [Symbol.asyncDispose]: async () => {} });
});
afterEach(() => vi.unstubAllEnvs());

it.each(["busy", "exhausted", "unknown"])("stops main before any harness on %s even when an API key exists", async (reason) => {
  vi.stubEnv("OPENAI_API_KEY", "fixture-key");
  mocks.context.codexPoolRefused = { status: "denied", reason };
  expect(await main()).toMatchObject({ success: false });
  expect(mocks.outputs).toHaveBeenCalledOnce();
  expect(mocks.installOpenCode).not.toHaveBeenCalled();
  expect(mocks.installCodexAuth).not.toHaveBeenCalled();
  expect(mocks.captureModels).not.toHaveBeenCalled();
});

it("passes pooled auth toward native startup without OpenCode storage or model discovery", async () => {
  mocks.context.codexPool = { status: "assigned", accountAlias: "Account 2" };
  mocks.context.dbSecrets = { CODEX_AUTH_JSON: '{"auth_mode":"chatgpt","tokens":{"access_token":"fixture","refresh_token":"fixture"}}' };
  mocks.resolveTokens.mockRejectedValue(new Error("native startup boundary"));
  await expect(main()).rejects.toThrow("native startup boundary");
  expect(mocks.installOpenCode).not.toHaveBeenCalled();
  expect(mocks.installCodexAuth).not.toHaveBeenCalled();
  expect(mocks.captureModels).not.toHaveBeenCalled();
  expect(process.env.CODEX_AUTH_JSON).toContain('"auth_mode":"chatgpt"');
});

it.each(["CODEX_AUTH_JSON", "CODEX_API_KEY", "OPENAI_API_KEY"])("rejects external %s before pooled auth is installed", async (key) => {
  mocks.context.codexPool = { status: "assigned", accountAlias: "Account 1" };
  vi.stubEnv(key, "external-credential");
  expect(await main()).toMatchObject({ success: false });
  expect(mocks.installOpenCode).not.toHaveBeenCalled();
  expect(mocks.installCodexAuth).not.toHaveBeenCalled();
});

it("rejects a non-Codex model in pool mode", async () => {
  mocks.context.codexPool = { status: "assigned", accountAlias: "Account 1" };
  mocks.model = "anthropic/claude-sonnet-4";
  expect(await main()).toMatchObject({ success: false });
  expect(mocks.installOpenCode).not.toHaveBeenCalled();
});
