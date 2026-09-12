import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mintRunToken } from "../convex/lib/runToken";
import { open, seal } from "../convex/lib/crypto";

vi.mock("../convex/lib/github", async (original) => ({
  ...await original<typeof import("../convex/lib/github")>(),
  findRepoInstallation: vi.fn(async () => ({ id: 1, repository_selection: "all", suspended_at: null })),
}));
const modules = import.meta.glob("../convex/**/*.ts");
const raw = (id = "private-provider", refresh = "private-refresh") => JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: id, access_token: "private-access", refresh_token: refresh } });
let login = "operator";
let ownerType = "Organization";
let push = true;
let membership = { state: "active", role: "member" };

beforeEach(() => {
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", btoa("x".repeat(32)));
  login = "operator"; ownerType = "Organization"; push = true; membership = { state: "active", role: "member" };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if ((init.headers as Record<string, string>).Authorization !== "Bearer operator-token") return new Response("{}", { status: 401 });
    if (url.endsWith("/user")) return Response.json({ login });
    if (url.includes("/user/memberships/orgs/")) return Response.json(membership);
    if (url.includes("/repos/")) return Response.json({ default_branch: "main", owner: { type: ownerType }, permissions: { push } });
    throw new Error(`Unexpected GitHub request: ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

function setup() {
  const t = convexTest(schema, modules);
  const post = (body: Record<string, unknown>, token = "operator-token") => t.fetch("/api/cli/secrets", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ owner: "owner", repo: "repo", scope: "repo", ...body }),
  });
  const get = (scope = "repo", token = "operator-token") => t.fetch(`/api/cli/secrets?owner=owner&repo=repo&codexPool=1&scope=${scope}`, { headers: { Authorization: `Bearer ${token}` } });
  return { t, post, get };
}

function sanitized(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of ["private-provider", "private-access", "private-refresh", "providerAccountId", "ciphertext", "ownershipToken"]) expect(text).not.toContain(secret);
}

describe("Codex named account management", () => {
  it("enrolls distinct accounts through the existing endpoint and preserves legacy secrets", async () => {
    const s = setup();
    expect((await s.post({ name: "CODEX_AUTH_JSON", value: raw("legacy-provider") })).status).toBe(200);
    expect((await s.post({ operation: "codex-enroll", label: "First", value: raw() })).status).toBe(200);
    const response = await s.post({ operation: "codex-enroll", label: "Second", value: raw("second-provider") });
    expect(response.status).toBe(200);
    const status = await response.json();
    expect(status).toMatchObject({ success: true, pool: null, accounts: [{ label: "First", enabled: true, busy: false, quota: null }, { label: "Second" }] });
    sanitized(status);
    expect((await s.post({ operation: "codex-enroll", label: "Duplicate", value: raw() })).status).toBe(400);
    expect(await s.t.query(internal.secrets.names, { owner: "owner", repo: "repo" })).toEqual({ account: [], repo: ["CODEX_AUTH_JSON"] });
    const legacy = await s.t.fetch("/api/cli/secrets?owner=owner&repo=repo", { headers: { Authorization: "Bearer operator-token" } });
    expect(await legacy.json()).toMatchObject({ accessible: true, pullfrogSecrets: ["CODEX_AUTH_JSON"] });
    expect((await s.get()).status).toBe(200);
  });

  it("derives missing account_id, seals canonical auth, and rejects conflicting identity", async () => {
    const s = setup();
    const value = JSON.parse(raw()); delete value.tokens.account_id;
    value.tokens.id_token = `header.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "private-provider" } }))}.signature`;
    expect((await s.post({ operation: "codex-enroll", label: "First", value: JSON.stringify(value) })).status).toBe(200);
    const [row] = await s.t.run((ctx) => ctx.db.query("codexAccounts").collect());
    expect(JSON.parse(await open(row!)).tokens.account_id).toBe("private-provider");
    value.tokens.account_id = "conflicting-provider";
    const bad = await s.post({ operation: "codex-enroll", label: "Bad", value: JSON.stringify(value) });
    expect(bad.status).toBe(400); sanitized(await bad.json());
  });

  it("requires GitHub operator authority for reads and every named mutation", async () => {
    const s = setup();
    vi.stubEnv("RUN_TOKEN_SECRET", "run-secret");
    const runToken = await mintRunToken({ owner: "owner", repo: "repo", runId: "123" });
    for (const token of ["invalid", "a".repeat(64), runToken]) {
      expect((await s.get("repo", token)).status).toBe(401);
      for (const operation of ["codex-enroll", "codex-replace", "codex-enable", "codex-pool"]) {
        expect((await s.post({ operation, label: "First", value: raw(), accountId: "invalid", enabled: false, accountIds: [] }, token)).status).toBe(401);
      }
    }
    push = false;
    expect((await s.get()).status).toBe(403);
    expect((await s.post({ operation: "codex-enroll", label: "First", value: raw() })).status).toBe(403);
    expect(await s.t.run((ctx) => ctx.db.query("codexAccounts").collect())).toEqual([]);
  });

  it("requires active owner administration for owner scope and owner pool membership", async () => {
    const s = setup();
    const id = await s.t.mutation(internal.codexAccounts.enroll, { owner: "owner", repo: null, label: "Shared", providerAccountId: "private-provider", ...await seal(raw()) });
    expect((await s.get("account")).status).toBe(403);
    for (const operation of ["codex-enroll", "codex-replace", "codex-enable", "codex-pool"]) {
      expect((await s.post({ operation, scope: "account", accountId: id, enabled: false, label: "Shared", value: raw(), accountIds: [id] })).status).toBe(403);
    }
    expect((await s.post({ operation: "codex-pool", accountIds: [id] })).status).toBe(403);
    membership = { state: "pending", role: "admin" };
    expect((await s.get("account")).status).toBe(403);
    membership = { state: "active", role: "admin" };
    expect((await s.get("account")).status).toBe(200);
    expect((await s.post({ operation: "codex-pool", accountIds: [id] })).status).toBe(200);
    membership.role = "member";
    const visible = await (await s.get()).json();
    expect(visible.accounts).toHaveLength(1); sanitized(visible);
    ownerType = "User"; login = "OWNER";
    expect((await s.post({ operation: "codex-enable", scope: "account", accountId: id, enabled: false })).status).toBe(200);
  });

  it("preserves occupancy and disablement across replacement, invalidates old quota, and excludes foreign scope", async () => {
    const s = setup();
    const first = await (await s.post({ operation: "codex-enroll", label: "First", value: raw() })).json();
    const id = first.accounts[0].id;
    await s.t.mutation(internal.codexQuota.record, { accountId: id, generation: 1, credentialVersion: 1, observedAt: Date.now(), result: { status: "available", weekly: { usedPercent: 10, windowSeconds: 604800, resetAt: 9999999999 } } });
    await s.post({ operation: "codex-pool", accountIds: [id], enabled: true });
    await s.t.mutation(internal.codexAssignments.reserve, { owner: "owner", repo: "repo", runId: "123", runAttempt: "1", runtimeInstance: "runtime", ownershipToken: "a".repeat(64), excludedIds: [] });
    const disabled = await (await s.post({ operation: "codex-enable", accountId: id, enabled: false })).json();
    expect(disabled.accounts[0]).toMatchObject({ id, enabled: false, busy: true });
    const replaced = await (await s.post({ operation: "codex-replace", accountId: id, value: raw("private-provider", "replacement") })).json();
    expect(replaced.accounts[0]).toMatchObject({ generation: 2, credentialVersion: 1, enabled: false, busy: true, quota: { fresh: false } });
    const foreign = await s.t.mutation(internal.codexAccounts.enroll, { owner: "owner", repo: "other", label: "Foreign", providerAccountId: "foreign", ...await seal(raw("foreign")) });
    for (const operation of ["codex-enable", "codex-replace", "codex-pool"]) expect((await s.post({ operation, accountId: foreign, accountIds: [foreign], enabled: true, value: raw("foreign") })).status).toBe(400);
    sanitized(replaced);
  });

  it("preserves pool priority and opt-in across configuration, and enables an idle account", async () => {
    const s = setup();
    await s.post({ operation: "codex-enroll", label: "First", value: raw() });
    const status = await (await s.post({ operation: "codex-enroll", label: "Second", value: raw("second-provider") })).json();
    const ids = status.accounts.map((row: { id: string }) => row.id).reverse();
    expect(await (await s.post({ operation: "codex-pool", accountIds: ids })).json()).toMatchObject({ pool: { enabled: false, accountIds: ids } });
    await s.post({ operation: "codex-pool", accountIds: ids, enabled: true });
    expect(await (await s.post({ operation: "codex-pool", accountIds: [...ids].reverse() })).json()).toMatchObject({ pool: { enabled: true, accountIds: [...ids].reverse() } });
    expect((await s.post({ operation: "codex-pool", accountIds: [ids[0], ids[0]] })).status).toBe(400);
    await s.post({ operation: "codex-enable", accountId: ids[0], enabled: false });
    const enabled = await (await s.post({ operation: "codex-enable", accountId: ids[0], enabled: true })).json();
    expect(enabled.accounts.find((row: { id: string }) => row.id === ids[0])).toMatchObject({ enabled: true, busy: false, authState: "ready" });
  });

  it("keeps GitHub failure bodies out of management errors", async () => {
    const s = setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private-access private-provider", { status: 500 })));
    const response = await s.get();
    expect(response.status).toBe(400); sanitized(await response.json());
  });

  it("validates scope, operation, boolean, and account ID shapes without leaking errors", async () => {
    const s = setup();
    for (const body of [
      { operation: "codex-enroll", scope: "invalid", label: "First", value: raw() },
      { operation: "codex-enroll", label: "", value: raw() },
      { operation: "codex-enroll", label: "First", value: "private-access" },
      { operation: "codex-enable", accountId: "not-an-id", enabled: false },
      { operation: "codex-enable", accountId: "not-an-id", enabled: "false" },
      { operation: "codex-pool", accountIds: "bad" },
      { operation: "codex-pool", accountIds: [], enabled: "true" },
      { operation: "codex-unknown" },
    ]) { const response = await s.post(body); expect(response.status).toBe(400); sanitized(await response.json()); }
    expect((await s.get("invalid")).status).toBe(400);
    for (const body of ["null", "123", '"text"', "[]", "{broken"]) {
      const response = await s.t.fetch("/api/cli/secrets", { method: "POST", headers: { Authorization: "Bearer operator-token" }, body });
      expect(response.status).toBe(400);
    }
  });

  it("returns authenticated mixed account health, including an explicitly disabled pool", async () => {
    const s = setup();
    const a = await (await s.post({ operation: "codex-enroll", label: "Healthy", value: raw() })).json();
    const b = await (await s.post({ operation: "codex-enroll", label: "Rejected", value: raw("second-provider") })).json();
    const ids = b.accounts.map((row: { id: string }) => row.id);
    await s.t.run((ctx) => ctx.db.patch(ids[1], { authState: "rejected" }));
    await s.post({ operation: "codex-pool", accountIds: ids, enabled: false });
    await expect(s.t.query(api.health.get, { owner: "owner", repo: "repo" })).rejects.toThrow("unauthenticated");
    const health = await s.t.withIdentity({ subject: "operator" }).query(api.health.get, { owner: "owner", repo: "repo" });
    expect(health).toMatchObject({ chain: null, codexPool: { pool: { enabled: false, accountIds: ids }, accounts: [{ id: a.accounts[0].id, authState: "ready" }, { authState: "rejected" }] } });
    sanitized(health);
  });
});
