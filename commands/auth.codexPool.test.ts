import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mint: vi.fn(), refresh: vi.fn(), log: vi.fn() }));
vi.mock("../utils/codexAuth.ts", () => ({ mintCodexAuth: mocks.mint, refreshCodexAuth: mocks.refresh }));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(), outro: vi.fn(), isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { info: mocks.log, warn: mocks.log, error: mocks.log },
}));
vi.mock("./_shared.ts", async (original) => ({
  ...await original<typeof import("./_shared.ts")>(),
  getGhToken: () => "operator-token", parseGitRemote: () => ({ owner: "acme", repo: "bot" }),
}));
import { runCli } from "./auth.ts";

const auth = { json: JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "fixture-access", refresh_token: "fixture-refresh", account_id: "second" } }) };
const status = { accounts: [{ id: "second", label: "Secondary", repo: "bot", enabled: false, busy: true,
  authState: "ready", generation: 1, credentialVersion: 1, quota: null }], pool: { enabled: false, accountIds: ["first", "second"] } };
let requests: { url: URL; method?: string; body?: Record<string, unknown> }[];
beforeEach(() => {
  requests = []; mocks.mint.mockReset().mockResolvedValue(auth); mocks.refresh.mockReset().mockResolvedValue(auth); mocks.log.mockClear();
  vi.spyOn(console, "log").mockImplementation(mocks.log);
  vi.stubGlobal("fetch", vi.fn(async (input, options) => {
    const url = new URL(String(input));
    requests.push({ url, method: options?.method, body: options?.body ? JSON.parse(options.body) : undefined });
    if (options?.method === "POST") return Response.json({ success: true, ...status });
    return Response.json(url.searchParams.has("codexPool") ? status : { installationId: 1, accessible: true, pullfrogSecrets: [], isOrg: false });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Codex pool operator CLI", () => {
  it("lists private account status using the existing secrets endpoint without starting login", async () => {
    await runCli({ args: ["codex", "list"], prog: "pullfrog" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.pathname).toBe("/api/cli/secrets");
    expect(requests[0]!.url.searchParams.get("codexPool")).toBe("1");
    expect(requests[0]!.url.searchParams.get("scope")).toBe("repo");
    expect(mocks.mint).not.toHaveBeenCalled();
    expect(mocks.log.mock.calls.flat().join("\n")).toContain("Secondary");
    expect(mocks.log.mock.calls.flat().join("\n")).toMatch(/still finishing/);
  });
  it("enrolls a named second account without overwriting the legacy secret or eagerly rotating the new chain", async () => {
    await runCli({ args: ["codex", "enroll", "Secondary", "--scope", "repo"], prog: "pullfrog" });
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      owner: "acme", repo: "bot", operation: "codex-enroll", scope: "repo", label: "Secondary", value: auth.json,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("replaces only the explicit account", async () => {
    await runCli({ args: ["codex", "replace", "second", "--scope", "account"], prog: "pullfrog" });
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      owner: "acme", repo: "bot", operation: "codex-replace", scope: "account", accountId: "second", value: auth.json,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(["enable", "disable"])("%ss the explicit account and prints the returned occupancy", async (operation) => {
    await runCli({ args: ["codex", operation, "second"], prog: "pullfrog" });
    expect(requests[0]!.body).toEqual({ owner: "acme", repo: "bot", operation: "codex-enable", scope: "repo", accountId: "second", enabled: operation === "enable" });
    expect(mocks.log.mock.calls.flat().join("\n")).toContain("Secondary");
    expect(mocks.log.mock.calls.flat().join("\n")).toContain("still finishing");
    expect(mocks.mint).not.toHaveBeenCalled();
  });
  it("sets ordered membership without implicitly enabling the pool", async () => {
    await runCli({ args: ["codex", "pool", "first", "second"], prog: "pullfrog" });
    expect(requests[0]!.body).toEqual({ owner: "acme", repo: "bot", operation: "codex-pool", scope: "repo", accountIds: ["first", "second"] });
  });
  it("enables a pool only with the explicit flag", async () => {
    await runCli({ args: ["codex", "pool", "first", "second", "--enable"], prog: "pullfrog" });
    expect(requests[0]!.body?.enabled).toBe(true);
  });
  it("keeps the no-argument legacy auth command", async () => {
    await runCli({ args: ["codex"], prog: "pullfrog" });
    const body = requests.find((r) => r.method === "POST")?.body;
    expect(body?.name).toBe("CODEX_AUTH_JSON");
    expect(body).not.toHaveProperty("operation");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("checks named-account API support before starting a human login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ installationId: 1, accessible: true, pullfrogSecrets: [], isOrg: false })));
    await expect(runCli({ args: ["codex", "enroll", "Secondary"], prog: "pullfrog" })).rejects.toThrow();
    expect(mocks.mint).not.toHaveBeenCalled();
  });
});
