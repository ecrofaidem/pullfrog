import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { open, seal } from "../convex/lib/crypto";
import { mintRunToken } from "../convex/lib/runToken";
import { bytesToBase64Url, utf8ToBase64Url } from "../convex/lib/base64";

const modules = import.meta.glob("../convex/**/*.ts");
const instance = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const poolHeaders = { "X-Pullfrog-Codex-Pool": "1", "X-Pullfrog-Codex-Pool-Required": "1", "X-Pullfrog-Run-Instance": instance };
let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const provider = vi.fn();
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});
beforeEach(() => {
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  vi.stubEnv("RUN_TOKEN_SECRET", "run-secret");
  provider.mockReset();
  provider.mockImplementation(async () => new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 3600 } } })));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url.includes("/.well-known/jwks")
    ? new Response(JSON.stringify({ keys: [{ ...jwk, kid: "test-key" }] })) : provider(url, init)));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function oidc(overrides: Record<string, unknown> = {}) {
  const header = utf8ToBase64Url(JSON.stringify({ alg: "RS256", kid: "test-key" }));
  const payload = utf8ToBase64Url(JSON.stringify({ iss: "https://token.actions.githubusercontent.com", aud: "pullfrog-api", exp: Math.floor(Date.now() / 1000) + 300, repository: "owner/repo", run_id: "123", run_attempt: "2", ...overrides }));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input));
  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function setup(enabled = true, expires = 7200) {
  const t = convexTest(schema, modules);
  const repo = await t.mutation(internal.repos.ensure, { owner: "owner", name: "repo" });
  await t.run((ctx) => ctx.db.patch(repo._id, { codexAgent: true }));
  const raw = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: `a.${utf8ToBase64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expires }))}.b`, refresh_token: "private-refresh", account_id: "provider-one" } });
  const id = await t.mutation(internal.codexAccounts.enroll, { owner: "owner", repo: null, label: "Private operator label", providerAccountId: "provider-one", ...await seal(raw) });
  await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [id], enabled });
  await t.mutation(internal.secrets.upsert, { owner: "owner", repo: "repo", name: "CODEX_AUTH_JSON", ...await seal(raw), updatedBy: "test" });
  await t.mutation(internal.secrets.upsert, { owner: "owner", repo: "repo", name: "OPENAI_API_KEY", ...await seal("billing-key"), updatedBy: "test" });
  const request = async (headers: Record<string, string> = poolHeaders, claims: Record<string, unknown> = {}) => t.fetch("/api/repo/owner/repo/run-context", { headers: { "X-GitHub-OIDC-Token": await oidc(claims), ...headers } });
  return { t, id, raw, request };
}

describe("signed pool startup handler", () => {
  it("returns only selected auth and recovers the same active assignment without another provider call", async () => {
    const { request } = await setup();
    const first = await request();
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.codexPool).toMatchObject({ status: "assigned", version: 1, accountAlias: "Account 1", runAttempt: "2", runtimeInstance: instance });
    expect(body.codexPool.capability).toMatch(/^[a-f0-9]{64}$/);
    expect(body.dbSecrets.CODEX_AUTH_JSON).toContain("private-refresh");
    expect(body.dbSecrets.OPENAI_API_KEY).toBeUndefined();
    expect(JSON.stringify(body.codexPool)).not.toContain("Private operator");
    expect((await (await request()).json()).codexPool).toEqual(body.codexPool);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { ...poolHeaders, "X-Pullfrog-Codex-Pool-Required": "" },
    { ...poolHeaders, "X-Pullfrog-Codex-External-Auth": "1" },
    { ...poolHeaders, "X-Pullfrog-Agent": "opencode" },
    { ...poolHeaders, "X-Pullfrog-Run-Instance": "bad" },
  ])("denies incompatible clients before secrets or provider calls: %j", async (headers) => {
    const { request, t } = await setup();
    const response = await request(headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ codexPool: { status: "denied", reason: "configuration" } });
    expect(provider).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("codexAssignments").collect())).toEqual([]);
  });

  it("requires verified run claims and rejects a modified signed claim", async () => {
    const { request, t } = await setup();
    expect((await request(poolHeaders, { run_attempt: undefined })).status).toBe(400);
    expect((await request(poolHeaders, { repository: "other/repo" })).status).toBe(403);
    const token = await oidc();
    const parts = token.split(".");
    parts[1] = utf8ToBase64Url(JSON.stringify({ repository: "owner/repo", run_id: "123", run_attempt: "99" }));
    const forged = await t.fetch("/api/repo/owner/repo/run-context", { headers: { ...poolHeaders, "X-GitHub-OIDC-Token": parts.join(".") } });
    expect(forged.status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });

  it("keeps disabled legacy startup and refuses required-pool downgrade", async () => {
    const { request, raw } = await setup(false);
    expect(await (await request({})).json()).toMatchObject({ dbSecrets: { CODEX_AUTH_JSON: raw, OPENAI_API_KEY: "billing-key" } });
    expect((await request()).status).toBe(400);
  });

  it("refreshes once under reservation and probes the new credential version", async () => {
    const { request, t, id } = await setup(true, -1);
    await t.mutation(internal.codexQuota.record, { accountId: id, generation: 1, credentialVersion: 1, observedAt: Date.now(), result: { status: "authentication" } });
    const usage = provider.getMockImplementation()!;
    provider.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("oauth/token")) {
        expect(await t.run((ctx) => ctx.db.query("codexAssignments").unique())).toMatchObject({ phase: "refreshing" });
        return new Response(JSON.stringify({ access_token: "rotated-access", refresh_token: "rotated-refresh" }));
      }
      expect(init.headers).toMatchObject({ Authorization: "Bearer rotated-access" });
      return usage(url, init);
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).dbSecrets.CODEX_AUTH_JSON).toContain("rotated-refresh");
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ credentialVersion: 2 });
    expect(await t.run((ctx) => ctx.db.query("codexQuotaObservations").unique())).toMatchObject({ credentialVersion: 2 });
    expect(await t.run((ctx) => ctx.db.query("codexAssignments").unique())).toMatchObject({ phase: "active", credentialVersion: 2 });
  });

  it("does not repeat OAuth during a duplicate in-flight startup", async () => {
    const { request, t } = await setup(true, -1);
    let finish: (response: Response) => void = () => {};
    let started: () => void = () => {};
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const delayed = new Promise<Response>((resolve) => { finish = resolve; });
    const usage = provider.getMockImplementation()!;
    provider.mockImplementation((url: string, init: RequestInit) => {
      if (url.includes("oauth/token")) { started(); return delayed; }
      return usage(url, init);
    });
    const first = request();
    await didStart;
    expect((await (await request()).json()).codexPool).toEqual({ status: "denied", reason: "unknown" });
    expect(await t.run((ctx) => ctx.db.query("codexAssignments").collect())).toHaveLength(1);
    finish(new Response(JSON.stringify({ access_token: "rotated-access", refresh_token: "rotated-refresh" })));
    expect((await first).status).toBe(200);
    expect(provider.mock.calls.filter(([url]) => url.includes("oauth/token"))).toHaveLength(1);
  });

  it("keeps lost refresh replies quarantined and never retries the old token", async () => {
    const { request, t, id } = await setup(true, -1);
    provider.mockRejectedValue(new Error("connection lost after provider rotation"));
    expect((await (await request()).json()).codexPool).toEqual({ status: "denied", reason: "unknown" });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ authState: "uncertain" });
    expect(await t.run((ctx) => ctx.db.query("codexAssignments").unique())).toMatchObject({ phase: "quarantined" });
    await request();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled refresh body even when the provider ignores abort", async () => {
    const { request, t } = await setup(true, -1);
    vi.useFakeTimers();
    let started: () => void = () => {};
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    provider.mockImplementation(async () => {
      started();
      return { ok: true, json: () => new Promise(() => {}) };
    });
    const response = request();
    await didStart;
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await (await response).json()).toEqual({ codexPool: { status: "denied", reason: "unknown" } });
    expect(await t.run((ctx) => ctx.db.query("codexAssignments").unique())).toMatchObject({ phase: "quarantined" });
  });

  it("admits only two of three simultaneous signed runs", async () => {
    const { request, t, id, raw } = await setup();
    const secondRaw = JSON.parse(raw);
    secondRaw.tokens.account_id = "provider-two";
    const second = await t.mutation(internal.codexAccounts.enroll, {
      owner: "owner", repo: null, label: "Secondary private label", providerAccountId: "provider-two", ...await seal(JSON.stringify(secondRaw)),
    });
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [id, second], enabled: true });
    const responses = await Promise.all([1, 2, 3].map((n) => request(poolHeaders, { run_id: String(n) })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 409]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies.find((body) => body.codexPool.status === "denied")).toEqual({ codexPool: { status: "denied", reason: "busy" } });
    const active = await t.run((ctx) => ctx.db.query("codexAssignments").collect());
    expect(active).toHaveLength(2);
    expect(new Set(active.map((assignment) => assignment.accountId)).size).toBe(2);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("shares one 20-second quota deadline across candidates", async () => {
    const { request, t, id, raw } = await setup();
    const secondRaw = JSON.parse(raw);
    secondRaw.tokens.account_id = "provider-two";
    const second = await t.mutation(internal.codexAccounts.enroll, {
      owner: "owner", repo: null, label: "Secondary", providerAccountId: "provider-two", ...await seal(JSON.stringify(secondRaw)),
    });
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [id, second], enabled: true });
    vi.useFakeTimers();
    let firstStarted: () => void = () => {};
    let secondStarted: () => void = () => {};
    const firstReady = new Promise<void>((resolve) => { firstStarted = resolve; });
    const secondReady = new Promise<void>((resolve) => { secondStarted = resolve; });
    provider.mockImplementation((_url: string, init: RequestInit) => {
      if (new Headers(init.headers).get("chatgpt-account-id") === "provider-one") {
        firstStarted();
        return new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("{}")), 15_000));
      }
      secondStarted();
      return new Promise(() => {});
    });
    const startedAt = Date.now();
    const response = request();
    await firstReady;
    await vi.advanceTimersByTimeAsync(15_000);
    await secondReady;
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await (await response).json()).toEqual({ codexPool: { status: "denied", reason: "unknown" } });
    expect(Date.now() - startedAt).toBe(20_001);
    const accounts = await t.run((ctx) => ctx.db.query("codexAccounts").collect());
    expect(accounts.every((account) => account.activeAssignmentId === undefined)).toBe(true);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it.each([{ error: { code: "token_expired", message: "private provider detail" } }, { error: "invalid_grant", error_description: "private provider detail" }])("latches definite refresh rejection without leaking provider errors: %j", async (failure) => {
    const { request, t, id } = await setup(true, -1);
    provider.mockResolvedValue(new Response(JSON.stringify(failure), { status: 401 }));
    expect(await (await request()).json()).toEqual({ codexPool: { status: "denied", reason: "authentication" } });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ authState: "rejected" });
    await request();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("continues to secondary after a definite primary refresh rejection", async () => {
    const { request, t, id, raw } = await setup(true, -1);
    const secondary = JSON.parse(raw);
    secondary.tokens.account_id = "provider-two";
    secondary.tokens.access_token = `a.${utf8ToBase64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 }))}.b`;
    const second = await t.mutation(internal.codexAccounts.enroll, {
      owner: "owner", repo: null, label: "Secondary", providerAccountId: "provider-two", ...await seal(JSON.stringify(secondary)),
    });
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [id, second], enabled: true });
    const usage = provider.getMockImplementation()!;
    provider.mockImplementation((url: string, init: RequestInit) => url.includes("oauth/token")
      ? new Response(JSON.stringify({ error: { code: "token_expired" } }), { status: 401 }) : usage(url, init));
    expect((await (await request()).json()).codexPool).toMatchObject({ status: "assigned", accountAlias: "Account 2" });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ authState: "rejected" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.activeAssignmentId).toBeUndefined();
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("blocks old write-back tokens while the pool is enabled and preserves disabled writes", async () => {
    const { t, raw } = await setup();
    const token = await mintRunToken({ owner: "owner", repo: "repo", runId: "previous-run" });
    const write = () => t.fetch("/api/runtime/secret", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "CODEX_AUTH_JSON", value: raw }) });
    expect((await write()).status).toBe(409);
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [], enabled: false });
    expect((await write()).status).toBe(200);
    const legacy = await t.query(internal.secrets.resolve, { owner: "owner", repo: "repo", name: "CODEX_AUTH_JSON" });
    expect(await open(legacy!)).toBe(raw);
  });
});
