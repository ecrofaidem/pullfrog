import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { open } from "../convex/lib/crypto";
import { bytesToBase64Url, utf8ToBase64Url } from "../convex/lib/base64";
import type { CodexPoolAssignment } from "../../utils/codexPoolProtocol";

vi.mock("../convex/lib/github", async (original) => ({
  ...await original<typeof import("../convex/lib/github")>(),
  findRepoInstallation: vi.fn(async () => ({ id: 1, repository_selection: "all", suspended_at: null })),
}));

const modules = import.meta.glob("../convex/**/*.ts");
const runtimeInstance = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const supportedHeaders = { "X-Pullfrog-Codex-Pool": "1", "X-Pullfrog-Run-Instance": runtimeInstance };
const requiredHeaders = { ...supportedHeaders, "X-Pullfrog-Codex-Pool-Required": "1" };
const usage = vi.fn<(account: string | null, accessToken: string | null) => void>();
let keys: CryptoKeyPair;
let jwk: JsonWebKey;

function auth(account: string, revision = "original") {
  return JSON.stringify({ auth_mode: "chatgpt", tokens: {
    access_token: `header.${utf8ToBase64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200, revision, account }))}.signature`,
    refresh_token: `${account}-${revision}-refresh`,
    account_id: account,
  } });
}

async function oidc(runId: string) {
  const header = utf8ToBase64Url(JSON.stringify({ alg: "RS256", kid: "integration-key" }));
  const payload = utf8ToBase64Url(JSON.stringify({
    iss: "https://token.actions.githubusercontent.com", aud: "pullfrog-api",
    exp: Math.floor(Date.now() / 1000) + 300, repository: "owner/repo", run_id: runId, run_attempt: "1",
  }));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input));
  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});

beforeEach(() => {
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", btoa("x".repeat(32)));
  vi.stubEnv("RUN_TOKEN_SECRET", "integration-run-secret");
  usage.mockClear();
  // Only external GitHub identity/installation and provider usage are simulated.
  // OAuth is deliberately unexpected: all fixture access tokens outlive preflight.
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/.well-known/jwks")) return Response.json({ keys: [{ ...jwk, kid: "integration-key" }] });
    const headers = new Headers(init?.headers);
    if (url === "https://chatgpt.com/backend-api/wham/usage") {
      const account = headers.get("chatgpt-account-id");
      usage(account, headers.get("authorization"));
      if (account !== "primary" && account !== "secondary") throw new Error("Unexpected quota account");
      return Response.json({ rate_limit: { primary_window: {
        used_percent: account === "primary" ? 100 : 25,
        limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 3600,
      } } });
    }
    if (url.startsWith("https://api.github.com/") && headers.get("authorization") === "Bearer operator-token") {
      if (url.endsWith("/user")) return Response.json({ login: "operator" });
      if (url.includes("/user/memberships/orgs/")) return Response.json({ state: "active", role: "member" });
      if (url.includes("/repos/")) return Response.json({ default_branch: "main", owner: { type: "Organization" }, permissions: { push: true } });
    }
    throw new Error(`Unexpected external request: ${url}`);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Codex pool rollout and rollback through HTTP", () => {
  it("preserves legacy startup, selects secondary, persists rotation for the next run, and drains before restoring the current chain", async () => {
    const t = convexTest(schema, modules);
    const repo = await t.mutation(internal.repos.ensure, { owner: "owner", name: "repo" });
    await t.run((ctx) => ctx.db.patch(repo._id, { codexAgent: true }));
    const operator = async (body: Record<string, unknown>) => {
      const response = await t.fetch("/api/cli/secrets", {
        method: "POST", headers: { Authorization: "Bearer operator-token", "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "owner", repo: "repo", scope: "repo", ...body }),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const start = async (runId: string, headers: Record<string, string>) => t.fetch("/api/repo/owner/repo/run-context", {
      headers: { "X-GitHub-OIDC-Token": await oidc(runId), ...headers },
    });
    const finalize = async (assignment: CodexPoolAssignment, result: { kind: "snapshot"; value: string } | { kind: "unchanged" }) => {
      const response = await t.fetch("/api/runtime/codex-pool", {
        method: "POST", headers: { Authorization: `Bearer ${assignment.capability}`, "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.assignmentId, childStopped: true, auth: result }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "released" });
    };

    const legacy = auth("legacy");
    const primary = auth("primary");
    const secondary = auth("secondary");
    await operator({ name: "CODEX_AUTH_JSON", value: legacy });
    await operator({ name: "OPENAI_API_KEY", value: "legacy-billing-key" });
    await operator({ operation: "codex-enroll", label: "Primary private label", value: primary });
    await operator({ operation: "codex-enroll", label: "Secondary private label", value: secondary });
    const enrolled = await t.run((ctx) => ctx.db.query("codexAccounts").collect());
    const primaryAccount = enrolled.find((row) => row.providerAccountId === "primary")!;
    const secondaryAccount = enrolled.find((row) => row.providerAccountId === "secondary")!;
    expect(enrolled).toHaveLength(2);
    expect(await open(primaryAccount)).toBe(primary);
    expect(await open(secondaryAccount)).toBe(secondary);
    expect(primaryAccount.ciphertext).not.toContain("primary-original-refresh");
    expect(secondaryAccount.ciphertext).not.toContain("secondary-original-refresh");
    const accountIds = [primaryAccount._id, secondaryAccount._id];
    expect(await operator({ operation: "codex-pool", accountIds, enabled: false })).toMatchObject({ pool: { enabled: false, accountIds } });

    // Old clients and compatible clients without the required flag keep legacy behavior.
    for (const headers of [{}, supportedHeaders]) {
      const response = await start("101", headers);
      expect(response.status).toBe(200);
      const context = await response.json();
      expect(context.codexPool).toBeUndefined();
      expect(context.dbSecrets).toEqual({ CODEX_AUTH_JSON: legacy, OPENAI_API_KEY: "legacy-billing-key" });
    }
    expect(usage).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("codexAssignments").collect())).toEqual([]);

    await operator({ operation: "codex-pool", accountIds, enabled: true });
    const unsupported = await start("102", {});
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({ codexPool: { status: "denied", reason: "configuration" } });
    expect(usage).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("codexAssignments").collect())).toEqual([]);

    const firstResponse = await start("103", requiredHeaders);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.codexPool).toMatchObject({ status: "assigned", version: 1, accountAlias: "Account 2", generation: 1, runAttempt: "1", runtimeInstance });
    expect(first.dbSecrets).toEqual({ CODEX_AUTH_JSON: secondary });
    expect(JSON.stringify(first.codexPool)).not.toContain("private label");
    expect(usage.mock.calls.map(([account]) => account)).toEqual(["primary", "secondary"]);
    const afterSelection = await t.run((ctx) => ctx.db.get(primaryAccount._id));
    expect(await open(afterSelection!)).toBe(primary);

    // Simulate the stopped native child's complete auth snapshot. The actual
    // auth-file/main-to-post transfer is covered by utils/codexPoolCleanup.test.ts.
    const rotated = auth("secondary", "rotated");
    await finalize(first.codexPool, { kind: "snapshot", value: rotated });
    const afterRotation = await t.run((ctx) => ctx.db.get(secondaryAccount._id));
    expect(await open(afterRotation!)).toBe(rotated);
    expect(afterRotation).toMatchObject({ generation: 1, credentialVersion: 2, authState: "ready" });
    expect(afterRotation!.activeAssignmentId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(primaryAccount._id))).toEqual(afterSelection);
    const legacyRow = (await t.query(internal.secrets.visibleTo, { owner: "owner", repo: "repo" })).find((row) => row.name === "CODEX_AUTH_JSON")!;
    expect(await open(legacyRow)).toBe(legacy);

    const nextResponse = await start("104", requiredHeaders);
    expect(nextResponse.status).toBe(200);
    const next = await nextResponse.json();
    expect(next.codexPool.accountAlias).toBe("Account 2");
    expect(next.codexPool.assignmentId).not.toBe(first.codexPool.assignmentId);
    expect(next.dbSecrets).toEqual({ CODEX_AUTH_JSON: rotated });
    expect(usage.mock.calls).toEqual([
      ["primary", `Bearer ${JSON.parse(primary).tokens.access_token}`],
      ["secondary", `Bearer ${JSON.parse(secondary).tokens.access_token}`],
      ["secondary", `Bearer ${JSON.parse(rotated).tokens.access_token}`],
    ]);
    expect(await t.query(internal.codexQuota.cached, {
      accountId: secondaryAccount._id, generation: 1, credentialVersion: 2,
      assignmentId: next.codexPool.assignmentId, ownershipToken: next.codexPool.capability,
    })).toMatchObject({ result: { status: "available" } });
    expect(await t.run((ctx) => ctx.db.get(primaryAccount._id))).toEqual(afterSelection);

    // Drain the exact final run before disabling membership. Restore its current
    // authorized snapshot through the operator API, never the pre-pool backup.
    await finalize(next.codexPool, { kind: "unchanged" });
    expect((await t.run((ctx) => ctx.db.query("codexAssignments").collect())).every((row) => row.phase === "released")).toBe(true);
    expect((await t.run((ctx) => ctx.db.query("codexAccounts").collect())).every((row) => row.activeAssignmentId === undefined)).toBe(true);
    await operator({ operation: "codex-pool", accountIds, enabled: false });
    await operator({ name: "CODEX_AUTH_JSON", value: rotated });
    const requiredAfterRollback = await start("105", requiredHeaders);
    expect(requiredAfterRollback.status).toBe(400);
    expect(await requiredAfterRollback.json()).toEqual({ codexPool: { status: "denied", reason: "configuration" } });
    for (const headers of [{}, supportedHeaders]) {
      const response = await start("106", headers);
      expect(response.status).toBe(200);
      const context = await response.json();
      expect(context.codexPool).toBeUndefined();
      expect(context.dbSecrets).toEqual({ CODEX_AUTH_JSON: rotated, OPENAI_API_KEY: "legacy-billing-key" });
    }
    expect(usage).toHaveBeenCalledTimes(3);
    expect(await t.run((ctx) => ctx.db.get(primaryAccount._id))).toEqual(afterSelection);
    expect((await t.run((ctx) => ctx.db.query("codexAccounts").collect())).every((row) => row.activeAssignmentId === undefined)).toBe(true);
  });
});
