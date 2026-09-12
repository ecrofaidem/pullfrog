import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./apiFetch.ts";
import { fetchRunContext } from "./runContext.ts";
import * as core from "@actions/core";

vi.mock("./apiFetch.ts", () => ({ apiFetch: vi.fn() }));
vi.mock("@actions/core", () => ({ saveState: vi.fn(), setSecret: vi.fn() }));

const request = { token: "job-token", repoContext: { owner: "owner", name: "repo" }, oidcToken: "oidc" };
const instance = "00000000-0000-4000-8000-000000000001";
const assignment = {
  status: "assigned", version: 1, assignmentId: "assignment-one", capability: "c".repeat(64),
  accountAlias: "Account 2", generation: 1, runAttempt: "1", runtimeInstance: instance,
};
const auth = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh" } });
const success = { settings: { codexAgent: true }, apiToken: "run-token", dbSecrets: { CODEX_AUTH_JSON: auth }, codexPool: assignment };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PULLFROG_CODEX_POOL_REQUIRED", "1");
  vi.stubEnv("STATE_codex_pool_instance", instance);
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Codex pool startup", () => {
  it.each(["busy", "exhausted", "authentication", "configuration", "unknown"])("preserves %s denial even with an API key available", async (reason) => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-api-key");
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ codexPool: { status: "denied", reason, retryAt: 2_000_000_000 } }, { status: 409 }));
    const result = await fetchRunContext(request);
    expect(result).toMatchObject({ codexPoolRefused: { status: "denied", reason, retryAt: 2_000_000_000 } });
    expect(result.dbSecrets).toBeUndefined();
  });

  it.each([
    () => Promise.resolve(new Response("server unavailable", { status: 503 })),
    () => Promise.resolve(new Response("invalid json", { status: 200 })),
    () => Promise.reject(new Error("network lost")),
    () => Promise.resolve(Response.json(null)),
  ])("fails closed when required context cannot be read", async (response) => {
    vi.mocked(apiFetch).mockImplementation(response);
    expect(await fetchRunContext(request)).toMatchObject({ codexPoolRefused: { reason: "unknown" } });
  });

  it("rejects a legacy response when the workflow requires a pool", async () => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ settings: {}, apiToken: "legacy", dbSecrets: { OPENAI_API_KEY: "key" } }));
    expect(await fetchRunContext(request)).toMatchObject({ codexPoolRefused: { reason: "configuration" } });
  });

  it("persists the assignment for post cleanup before returning its auth", async () => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json(success));
    const result = await fetchRunContext(request);
    expect(result).toMatchObject({ codexPool: assignment, dbSecrets: { CODEX_AUTH_JSON: auth } });
    expect(core.setSecret).toHaveBeenCalledWith(assignment.capability);
    expect(core.saveState).toHaveBeenCalledWith("codex_pool_instance", instance);
    expect(core.saveState).toHaveBeenCalledWith("oauth_writeback", expect.stringContaining('"childState":"not_started"'));
    const state = vi.mocked(core.saveState).mock.calls.find(([key]) => key === "oauth_writeback")?.[1];
    expect(JSON.parse(String(state))).toMatchObject({ apiToken: "run-token", entries: [], codexPool: { assignment } });
    expect(apiFetch).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.objectContaining({
      "X-Pullfrog-Codex-Pool": "1", "X-Pullfrog-Codex-Pool-Required": "1", "X-Pullfrog-Run-Instance": instance,
    }) }));
  });

  it("keeps cleanup authority when an assigned response has unusable auth", async () => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ ...success, dbSecrets: {} }));
    expect(await fetchRunContext(request)).toMatchObject({ codexPoolRefused: { reason: "configuration" } });
    expect(core.saveState).toHaveBeenCalledWith("oauth_writeback", expect.stringContaining(assignment.assignmentId));
  });

  it("recovers a lost response with the same persisted instance", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response('{"codexPool":'))
      .mockResolvedValueOnce(Response.json(success));
    expect(await fetchRunContext(request)).toMatchObject({ codexPool: assignment });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiFetch).mock.calls.map(([options]) => options.headers?.["X-Pullfrog-Run-Instance"])).toEqual([instance, instance]);
  });

  it("bounds both transport attempts and stops after timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(30_000);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1);
      return controller.signal;
    });
    vi.mocked(apiFetch).mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
    }));
    const result = fetchRunContext(request);
    await vi.advanceTimersByTimeAsync(2);
    expect(await result).toMatchObject({ codexPoolRefused: { reason: "unknown" } });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it.each([{ version: 2 }, { runtimeInstance: "different" }, { runAttempt: "2" }, { accountAlias: "private@example.com" }])("rejects an incompatible or misbound assignment %j", async (patch) => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ ...success, codexPool: { ...assignment, ...patch } }));
    expect(await fetchRunContext(request)).toMatchObject({ codexPoolRefused: { reason: "configuration" } });
    expect(core.saveState).not.toHaveBeenCalledWith("oauth_writeback", expect.anything());
  });

  it("also preserves an explicit pool denial without the required flag", async () => {
    vi.stubEnv("PULLFROG_CODEX_POOL_REQUIRED", "");
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ codexPool: { status: "denied", reason: "busy" } }, { status: 409 }));
    expect(await fetchRunContext(request)).toMatchObject({ codexPoolRefused: { reason: "busy" } });
  });

  it("preserves legacy startup and legacy network fallback when pool is not required", async () => {
    vi.stubEnv("PULLFROG_CODEX_POOL_REQUIRED", "");
    vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ settings: {}, apiToken: "legacy", dbSecrets: { CODEX_AUTH_JSON: auth } }));
    expect(await fetchRunContext(request)).toMatchObject({ apiToken: "legacy", dbSecrets: { CODEX_AUTH_JSON: auth } });
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("network lost"));
    const fallback = await fetchRunContext(request);
    expect(fallback).toMatchObject({ secretsUnavailable: true });
    expect(fallback).not.toHaveProperty("codexPoolRefused");
  });
});
