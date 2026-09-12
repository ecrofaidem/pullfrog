import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { mintRunToken } from "../convex/lib/runToken";
import { open, seal } from "../convex/lib/crypto";

vi.mock("../convex/lib/github", async (original) => ({
  ...await original<typeof import("../convex/lib/github")>(),
  findRepoInstallation: vi.fn(async () => ({ id: 1 })),
  createInstallationToken: vi.fn(async () => ({ token: "installation" })),
}));
const modules = import.meta.glob("../convex/**/*.ts");
const capability = "a".repeat(64);
const raw = (account = "provider-0", refresh = "refresh") => JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: account, access_token: "access", refresh_token: refresh } });
const attempt = { owner: "owner", repo: "repo", runId: "123", runAttempt: "2", runtimeInstance: "instance", ownershipToken: capability, excludedIds: [] };

async function setup(phase: "reserved" | "refreshing" | "active" | "quarantined" | "released" = "active") {
  const t = convexTest(schema, modules);
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const id = await t.mutation(internal.codexAccounts.enroll, { owner: "owner", repo: null, label: `Private ${i}`, providerAccountId: `provider-${i}`, ...await seal(raw(`provider-${i}`)) });
    ids.push(id);
    await t.mutation(internal.codexQuota.record, { accountId: id, generation: 1, credentialVersion: 1, observedAt: Date.now(), result: { status: "available", weekly: { usedPercent: 10, windowSeconds: 604800, resetAt: 9999999999 } } });
  }
  await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: ids, enabled: true });
  const reservation = await t.mutation(internal.codexAssignments.reserve, attempt);
  if (reservation.status !== "reserved") throw new Error("reservation missing");
  const assignmentId = reservation.assignment._id;
  const fence = { assignmentId, ownershipToken: capability, generation: 1, credentialVersion: 1 };
  if (phase === "active") await t.mutation(internal.codexAssignments.activate, fence);
  if (phase === "refreshing" || phase === "quarantined") await t.mutation(internal.codexAssignments.refreshStarted, fence);
  if (phase === "quarantined" || phase === "released") await t.mutation(internal.codexAssignments.abandon, { ...fence, reason: "unknown" });
  const post = (auth: unknown = { kind: "snapshot", value: raw("provider-0", "rotated") }, token = capability, childStopped = true) => t.fetch("/api/runtime/codex-pool", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId, childStopped, auth }),
  });
  const account = () => t.run((ctx) => ctx.db.get(ids[0]!));
  return { t, ids, assignmentId, post, account, fence };
}

beforeEach(() => { vi.stubEnv("SECRETS_ENCRYPTION_KEY", btoa("x".repeat(32))); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Codex stopped-child finalization", () => {
  it("stores only the selected auth and atomically releases it", async () => {
    const s = await setup();
    const other = await s.t.run((ctx) => ctx.db.get(s.ids[1]!));
    expect(await (await s.post()).json()).toEqual({ status: "released" });
    const current = (await s.account())!;
    expect(await open(current)).toBe(raw("provider-0", "rotated"));
    expect(current).toMatchObject({ credentialVersion: 2, authState: "ready" });
    expect(current.activeAssignmentId).toBeUndefined();
    expect(await s.t.run((ctx) => ctx.db.get(s.ids[1]!))).toEqual(other);
  });

  it("invalidates cached quota even when unchanged, and never restarts a finalized attempt", async () => {
    const s = await setup();
    expect(await (await s.post({ kind: "unchanged" })).json()).toEqual({ status: "released" });
    expect(await s.account()).toMatchObject({ credentialVersion: 2 });
    expect(await s.t.query(internal.codexQuota.cached, { accountId: s.ids[0]!, generation: 1, credentialVersion: 2 })).toBeNull();
    expect(await s.t.mutation(internal.codexAssignments.reserve, attempt)).toMatchObject({ status: "denied" });
    expect(await s.t.mutation(internal.codexQuota.record, { accountId: s.ids[0]!, generation: 1, credentialVersion: 1, observedAt: Date.now(), result: { status: "unknown", reason: "network" } })).toBe(false);
  });

  it("returns a stable duplicate receipt without overwriting a later assignment", async () => {
    const s = await setup();
    await s.post();
    await s.t.mutation(internal.codexAssignments.reserve, { ...attempt, runId: "456", ownershipToken: "b".repeat(64) });
    const current = await s.account();
    expect(await (await s.post({ kind: "uncertain" })).json()).toEqual({ status: "released" });
    expect(await s.account()).toEqual(current);
  });

  it.each(["snapshot", "uncertain"])("fences stale %s after reenrollment and clears only old occupancy", async (kind) => {
    const s = await setup();
    await s.t.mutation(internal.codexAccounts.replace, { owner: "owner", repo: null, accountId: s.ids[0]!, providerAccountId: "provider-0", ...await seal(raw("provider-0", "replacement")) });
    const replacement = (await s.account())!;
    expect(await (await s.post(kind === "snapshot" ? { kind, value: raw() } : { kind })).json()).toEqual({ status: "stale" });
    const current = (await s.account())!;
    expect(current).toMatchObject({ generation: 2, credentialVersion: 1, authState: "ready", ciphertext: replacement.ciphertext });
    expect(current.activeAssignmentId).toBeUndefined();
  });

  it("allows an active disabled account to finalize", async () => {
    const s = await setup();
    await s.t.mutation(internal.codexAccounts.setEnabled, { owner: "owner", repo: null, accountId: s.ids[0]!, enabled: false });
    expect(await (await s.post()).json()).toEqual({ status: "released" });
    expect(await s.account()).toMatchObject({ enabled: false, credentialVersion: 2 });
  });

  it.each(["b".repeat(64), "eyJhbGciOiJIUzI1NiJ9.run.signature"])("rejects wrong capability or generic run JWT", async (token) => {
    const s = await setup(); const before = await s.account();
    expect((await s.post(undefined, token)).status).toBe(403);
    expect(await s.account()).toEqual(before);
  });

  it("rejects a valid generic run token and unknown assignment without leaking state", async () => {
    const s = await setup(); const before = await s.account();
    vi.stubEnv("RUN_TOKEN_SECRET", "run-token-test-secret");
    const token = await mintRunToken({ owner: "owner", repo: "repo", runId: "123" });
    expect((await s.post(undefined, token)).status).toBe(403);
    const response = await s.t.fetch("/api/runtime/codex-pool", { method: "POST", headers: { Authorization: `Bearer ${capability}` }, body: JSON.stringify({ assignmentId: "unknown", childStopped: true, auth: { kind: "unchanged" } }) });
    expect(response.status).toBe(403);
    expect(await s.account()).toEqual(before);
  });

  it("derives a missing account_id from token claims and preserves it for next startup", async () => {
    const s = await setup();
    const idToken = `header.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "provider-0" } }))}.signature`;
    const value = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", id_token: idToken } });
    expect(await (await s.post({ kind: "snapshot", value })).json()).toEqual({ status: "released" });
    expect(JSON.parse(await open((await s.account())!)).tokens.account_id).toBe("provider-0");
  });

  it.each(["conflicting-claims", "malformed-optional", "rejected-latch"])("quarantines %s in a complete-looking snapshot", async (variant) => {
    const s = await setup();
    const body = JSON.parse(raw());
    if (variant === "conflicting-claims") body.tokens.id_token = `header.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "foreign" } }))}.signature`;
    if (variant === "malformed-optional") body.tokens.id_token = 42;
    if (variant === "rejected-latch") body.refresh_rejected_at = new Date().toISOString();
    expect(await (await s.post({ kind: "snapshot", value: JSON.stringify(body) })).json()).toEqual({ status: "quarantined" });
  });

  it("does not change anything until child stop is confirmed", async () => {
    const s = await setup(); const before = await s.account();
    expect((await s.post(undefined, capability, false)).status).toBe(409);
    expect(await s.account()).toEqual(before);
  });

  it.each([raw("foreign"), "{broken", JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "provider-0", access_token: "access" } })])("quarantines invalid known-stopped auth", async (value) => {
    const s = await setup(); const before = (await s.account())!;
    expect(await (await s.post({ kind: "snapshot", value })).json()).toEqual({ status: "quarantined" });
    expect(await s.account()).toMatchObject({ authState: "uncertain", credentialVersion: 2, ciphertext: before.ciphertext });
    expect((await s.account())!.activeAssignmentId).toBeUndefined();
  });

  it("does not heal rejected stored auth using unchanged", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.ids[0]!, { authState: "rejected" }));
    expect(await (await s.post({ kind: "unchanged" })).json()).toEqual({ status: "quarantined" });
  });
});

describe("GitHub exact-attempt reconciliation", () => {
  function github(response: unknown, status = 200) {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response), { status }));
    vi.stubGlobal("fetch", fetcher); return fetcher;
  }
  it.each(["reserved", "refreshing", "active", "quarantined", "released"] as const)("recovers terminal %s without refreshing tokens", async (phase) => {
    const s = await setup(phase); const before = (await s.account())!;
    const fetcher = github({ id: 123, run_attempt: 2, status: "completed" });
    await s.t.action(internal.codexAssignments.reconcile, {});
    const current = (await s.account())!;
    expect(current.activeAssignmentId).toBeUndefined();
    expect(current.authState).toBe(phase === "reserved" || phase === "released" ? "ready" : "uncertain");
    expect(current.ciphertext).toBe(before.ciphertext);
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/actions/runs/123/attempts/2", expect.anything());
    const result = phase === "reserved" || phase === "released" ? "released" : "quarantined";
    expect(await (await s.post()).json()).toEqual({ status: result });
    expect(await s.account()).toEqual(current);
    expect(await s.t.mutation(internal.codexAssignments.reserve, attempt)).toMatchObject({ status: "denied" });
  });

  it.each(["running", "wrong-attempt", "404", "network"])("retains occupancy on %s despite old timestamps", async (proof) => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.assignmentId, { updatedAt: 0 }));
    const before = await s.account();
    if (proof === "network") vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    else github({ id: 123, run_attempt: proof === "wrong-attempt" ? 3 : 2, status: proof === "running" ? "in_progress" : "completed" }, proof === "404" ? 404 : 200);
    await s.t.action(internal.codexAssignments.reconcile, {});
    expect(await s.account()).toEqual(before);
  });

  it("keeps the successful post receipt when reconciliation returns later", async () => {
    const s = await setup();
    let release!: () => void;
    let contacted!: () => void;
    const waiting = new Promise<void>((resolve) => { contacted = resolve; });
    const proceed = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      contacted(); await proceed;
      return new Response(JSON.stringify({ id: 123, run_attempt: 2, status: "completed" }));
    }));
    const reconciliation = s.t.action(internal.codexAssignments.reconcile, {});
    await waiting;
    expect(await (await s.post()).json()).toEqual({ status: "released" });
    const current = await s.account();
    release(); await reconciliation;
    expect(await s.account()).toEqual(current);
    expect(await (await s.post({ kind: "uncertain" })).json()).toEqual({ status: "released" });
  });

  it("does not overwrite a newer active phase using stale reserved progress", async () => {
    const s = await setup("reserved");
    // Terminal proof belongs to the exact attempt, but the mutation must use current handoff progress.
    await s.t.mutation(internal.codexAssignments.activate, s.fence);
    expect(await s.t.mutation(internal.codexAssignments.terminal, { ...s.fence, accountId: s.ids[0]! })).toEqual({ status: "quarantined" });
  });

  it("preserves replacement auth and health when recovering an old execution", async () => {
    const s = await setup();
    await s.t.mutation(internal.codexAccounts.replace, { owner: "owner", repo: null, accountId: s.ids[0]!, providerAccountId: "provider-0", ...await seal(raw("provider-0", "replacement")) });
    github({ id: 123, run_attempt: 2, status: "completed" });
    await s.t.action(internal.codexAssignments.reconcile, {});
    expect(await s.account()).toMatchObject({ generation: 2, credentialVersion: 1, authState: "ready" });
    expect((await s.account())!.activeAssignmentId).toBeUndefined();
    expect(await (await s.post()).json()).toEqual({ status: "stale" });
  });
});
