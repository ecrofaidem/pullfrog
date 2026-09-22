import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { probeCodexQuota } from "../../utils/codexQuota";

const modules = import.meta.glob("../convex/**/*.ts");
const providerWeekly = { used_percent: 99.6, limit_window_seconds: 604800, reset_at: 2_000_000_000 };
const request = () => ({ accessToken: "secret", accountId: "private-provider-id", deadline: Date.now() + 20_000 });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("bounded Codex quota probe", () => {
  it.each([
    [401, {}, "authentication"],
    [403, {}, "provider_denied"],
    [429, { error: { message: "Too many requests" } }, "unknown"],
    [429, { rate_limit: { primary_window: providerWeekly } }, "unknown"],
    [429, { rate_limit: { allowed: false, primary_window: providerWeekly } }, "provider_denied"],
    [429, { rate_limit: { primary_window: { ...providerWeekly, used_percent: 100 } } }, "exhausted"],
    [200, { rate_limit: { primary_window: providerWeekly } }, "available"],
    [200, {}, "unknown"],
  ])("keeps provider status %s with %j distinct as %s", async (status, body, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: Number(status) })));
    expect(await probeCodexQuota(request())).toMatchObject({ status: expected });
  });

  it("bounds the entire response, including an unreadable body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }))));
    const result = probeCodexQuota({ ...request(), deadline: Date.now() + 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toEqual({ status: "unknown", reason: "timeout" });
  });

  it("does no HTTP work after the deadline or caller abort", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await probeCodexQuota({ ...request(), deadline: Date.now() })).toEqual({ status: "unknown", reason: "timeout" });
    expect(await probeCodexQuota({ ...request(), signal: AbortSignal.abort() })).toEqual({ status: "unknown", reason: "aborted" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

const account = { owner: "owner", repo: null, label: "Private label", providerAccountId: "private-subscription", ciphertext: "sealed", iv: "iv" };
const result = { status: "available", weekly: { usedPercent: 99.6, windowSeconds: 604800, resetAt: 2_000_000_000 } } as const;

describe("fenced quota observations", () => {
  it("shares a fresh observation with a reservation, rejecting a delayed idle writer", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.mutation(internal.codexAccounts.enroll, account);
    const fence = { accountId, generation: 1, credentialVersion: 1 };
    expect(await t.mutation(internal.codexQuota.record, { ...fence, observedAt: Date.now(), result })).toBe(true);
    expect(await t.query(internal.codexQuota.cached, fence)).toMatchObject({ result });
    await t.run((ctx) => ctx.db.patch(accountId, { activeAssignmentId: "run-one", activeOwnershipToken: "token-one" }));
    expect(await t.mutation(internal.codexQuota.record, { ...fence, observedAt: Date.now(), result: { status: "authentication" } })).toBe(false);
    expect(await t.query(internal.codexQuota.cached, fence)).toBeNull();
    const owned = { ...fence, assignmentId: "run-one", ownershipToken: "token-one" };
    expect(await t.query(internal.codexQuota.cached, owned)).toMatchObject({ result });
    expect(await t.mutation(internal.codexQuota.record, { ...owned, ownershipToken: "wrong", observedAt: Date.now(), result })).toBe(false);
    expect(JSON.stringify(await t.query(internal.codexQuota.cached, owned))).not.toMatch(/private|ciphertext|ownershipToken/);
  });
});

it("discards generation/version-stale observations and delayed writes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  const t = convexTest(schema, modules);
  const accountId = await t.mutation(internal.codexAccounts.enroll, account);
  const fence = { accountId, generation: 1, credentialVersion: 1 };
  const observedAt = Date.now();
  await t.mutation(internal.codexQuota.record, { ...fence, observedAt, result });
  await t.mutation(internal.codexAccounts.replace, { owner: "owner", repo: null, accountId, providerAccountId: account.providerAccountId, ciphertext: "new", iv: "new" });
  expect(await t.mutation(internal.codexQuota.record, { ...fence, observedAt: Date.now(), result })).toBe(false);
  expect(await t.query(internal.codexQuota.cached, { ...fence, generation: 2 })).toBeNull();
  await t.run((ctx) => ctx.db.patch(accountId, { credentialVersion: 2 }));
  expect(await t.mutation(internal.codexQuota.record, { ...fence, generation: 2, observedAt: Date.now(), result })).toBe(false);
});

it("never reuses unknown, stale, or reset-crossed observations", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  const t = convexTest(schema, modules);
  const accountId = await t.mutation(internal.codexAccounts.enroll, account);
  const fence = { accountId, generation: 1, credentialVersion: 1 };
  await t.mutation(internal.codexQuota.record, { ...fence, observedAt: Date.now(), result: { status: "unknown", reason: "http" } });
  expect(await t.query(internal.codexQuota.cached, fence)).toBeNull();
  await t.mutation(internal.codexQuota.record, { ...fence, observedAt: Date.now(), result });
  vi.advanceTimersByTime(60_000);
  expect(await t.query(internal.codexQuota.cached, fence)).toBeNull();
  await t.mutation(internal.codexQuota.record, { ...fence, observedAt: Date.now(), result: { status: "exhausted", weekly: { ...result.weekly, usedPercent: 100, resetAt: Date.now() / 1000 + 1 } } });
  expect(await t.query(internal.codexQuota.cached, fence)).toMatchObject({ result: { status: "exhausted" } });
  vi.advanceTimersByTime(1_000);
  expect(await t.query(internal.codexQuota.cached, fence)).toBeNull();
});

it("scheduled reads reuse fresh evidence, probe stale accounts once, and skip owned or disabled pools", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  const { seal } = await import("../convex/lib/crypto");
  const sealed = await seal(JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", account_id: account.providerAccountId } }));
  const t = convexTest(schema, modules);
  const accountId = await t.mutation(internal.codexAccounts.enroll, { ...account, ...sealed });
  await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [accountId], enabled: true });
  const fence = { accountId, generation: 1, credentialVersion: 1 };
  await t.mutation(internal.codexQuota.record, { ...fence, observedAt: Date.now(), result });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rate_limit: { primary_window: providerWeekly } })));
  vi.stubGlobal("fetch", fetcher);
  await t.action(internal.codexQuota.refreshIdle, {});
  expect(fetcher).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  await t.action(internal.codexQuota.refreshIdle, {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://chatgpt.com/backend-api/wham/usage");
  expect(await t.query(internal.codexQuota.cached, fence)).toMatchObject({ result });
  await t.run((ctx) => ctx.db.patch(accountId, { activeAssignmentId: "runner", activeOwnershipToken: "token" }));
  vi.advanceTimersByTime(60_000);
  await t.action(internal.codexQuota.refreshIdle, {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  await t.run((ctx) => ctx.db.patch(accountId, { activeAssignmentId: undefined, activeOwnershipToken: undefined }));
  await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [accountId], enabled: false });
  await t.action(internal.codexQuota.refreshIdle, {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.unstubAllEnvs();
});
