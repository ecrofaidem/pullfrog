import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const repo = { owner: "owner", repo: "repo" };
const attempt = { ...repo, runId: "1", runAttempt: "1", runtimeInstance: "instance-1", ownershipToken: "token-1", excludedIds: [] };

async function setup(percentages = [10, 20]) {
  const t = convexTest(schema, modules);
  const ids = [];
  for (const [i, usedPercent] of percentages.entries()) {
    const id = await t.mutation(internal.codexAccounts.enroll, {
      owner: "owner", repo: null, label: `Private ${i}`, providerAccountId: `provider-${i}`, ciphertext: "ciphertext", iv: "iv",
    });
    ids.push(id);
    await t.mutation(internal.codexQuota.record, {
      accountId: id, generation: 1, credentialVersion: 1, observedAt: Date.now(),
      result: { status: usedPercent < 100 ? "available" : "exhausted", weekly: { usedPercent, windowSeconds: 604800, resetAt: Math.floor(Date.now() / 1000) + 100 + i } },
    });
  }
  await t.mutation(internal.codexAccounts.configurePool, { ...repo, accountIds: ids, enabled: true });
  return { t, ids };
}

describe("Codex assignment reservation", () => {
  it("serializes three runs across two canonical accounts", async () => {
    const { t } = await setup();
    const results = await Promise.all([1, 2, 3].map((n) => t.mutation(internal.codexAssignments.reserve, {
      ...attempt, runId: String(n), ownershipToken: `token-${n}`,
    })));
    expect(results.filter((result) => result.status === "reserved")).toHaveLength(2);
    expect(results.filter((result) => result.status === "denied")).toEqual([{ status: "denied", reason: "busy" }]);
    expect(new Set(results.flatMap((result) => result.status === "reserved" ? [result.account._id] : [])).size).toBe(2);
  });

  it("skips 100 percent but keeps raw 99.6 percent capacity", async () => {
    const { t, ids } = await setup([100, 99.6]);
    const result = await t.mutation(internal.codexAssignments.reserve, attempt);
    expect(result).toMatchObject({ status: "reserved", account: { _id: ids[1] }, assignment: { accountAlias: "Account 2" } });
  });

  it("reports earliest reset when every account is exhausted", async () => {
    const { t } = await setup([100, 100]);
    expect(await t.mutation(internal.codexAssignments.reserve, attempt)).toEqual({ status: "denied", reason: "exhausted", retryAt: Math.floor(Date.now() / 1000) + 100 });
  });

  it("recovers active same-instance requests and rejects duplicate preflight and competing instances", async () => {
    const { t } = await setup();
    const first = await t.mutation(internal.codexAssignments.reserve, attempt);
    if (first.status !== "reserved") throw new Error("expected reservation");
    const fence = { assignmentId: first.assignment._id, ownershipToken: attempt.ownershipToken, generation: 1, credentialVersion: 1 };
    expect(await t.mutation(internal.codexAssignments.reserve, { ...attempt, ownershipToken: "duplicate" })).toEqual({ status: "denied", reason: "unknown" });
    expect(await t.mutation(internal.codexAssignments.reserve, { ...attempt, runtimeInstance: "competing" })).toEqual({ status: "denied", reason: "configuration" });
    expect(await t.mutation(internal.codexAssignments.activate, fence)).toBe(true);
    expect(await t.mutation(internal.codexAssignments.reserve, { ...attempt, ownershipToken: "retry" })).toMatchObject({ status: "active", assignment: { _id: first.assignment._id } });
  });

  it.each(["disable", "remove", "replace"])("rechecks %s before activating", async (change) => {
    const { t, ids } = await setup();
    const result = await t.mutation(internal.codexAssignments.reserve, attempt);
    if (result.status !== "reserved") throw new Error("expected reservation");
    const id = ids[0]!;
    if (change === "disable") await t.mutation(internal.codexAccounts.setEnabled, { owner: "owner", repo: null, accountId: id, enabled: false });
    if (change === "remove") await t.mutation(internal.codexAccounts.configurePool, { ...repo, accountIds: [ids[1]!] });
    if (change === "replace") await t.mutation(internal.codexAccounts.replace, { owner: "owner", repo: null, accountId: id, providerAccountId: "provider-0", ciphertext: "new", iv: "new" });
    expect(await t.mutation(internal.codexAssignments.activate, { assignmentId: result.assignment._id, ownershipToken: attempt.ownershipToken, generation: 1, credentialVersion: 1 })).toBe(false);
  });

  it("shares occupancy across repository memberships and run attempts", async () => {
    const { t, ids } = await setup([10]);
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "other", accountIds: ids, enabled: true });
    await t.mutation(internal.codexAssignments.reserve, attempt);
    expect(await t.mutation(internal.codexAssignments.reserve, { ...attempt, repo: "other" })).toEqual({ status: "denied", reason: "busy" });
    expect(await t.mutation(internal.codexAssignments.reserve, { ...attempt, runAttempt: "2" })).toEqual({ status: "denied", reason: "busy" });
  });

  it("quarantines uncertain rotation and rejects a delayed refresh result", async () => {
    const { t, ids } = await setup([10]);
    const result = await t.mutation(internal.codexAssignments.reserve, attempt);
    if (result.status !== "reserved") throw new Error("expected reservation");
    const fence = { assignmentId: result.assignment._id, ownershipToken: attempt.ownershipToken, generation: 1, credentialVersion: 1 };
    expect(await t.mutation(internal.codexAssignments.refreshStarted, fence)).toBe(true);
    await t.mutation(internal.codexAssignments.abandon, { ...fence, reason: "unknown" });
    expect(await t.run((ctx) => ctx.db.get(ids[0]!))).toMatchObject({ authState: "uncertain", activeAssignmentId: result.assignment._id, credentialVersion: 2 });
    expect(await t.mutation(internal.codexAssignments.commitRefresh, { ...fence, providerAccountId: "provider-0", ciphertext: "late", iv: "late" })).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(result.assignment._id))).toMatchObject({ phase: "quarantined", credentialVersion: 2 });
    expect(await t.mutation(internal.codexAssignments.reserve, { ...attempt, ownershipToken: "retry" })).toEqual({ status: "denied", reason: "unknown" });
  });

  it("cannot poison replacement credentials after refresh starts", async () => {
    const { t, ids } = await setup([10]);
    const result = await t.mutation(internal.codexAssignments.reserve, attempt);
    if (result.status !== "reserved") throw new Error("expected reservation");
    const fence = { assignmentId: result.assignment._id, ownershipToken: attempt.ownershipToken, generation: 1, credentialVersion: 1 };
    await t.mutation(internal.codexAssignments.refreshStarted, fence);
    await t.mutation(internal.codexAccounts.replace, { owner: "owner", repo: null, accountId: ids[0]!, providerAccountId: "provider-0", ciphertext: "replacement", iv: "replacement" });
    expect(await t.mutation(internal.codexAssignments.commitRefresh, { ...fence, providerAccountId: "provider-0", ciphertext: "old-result", iv: "old" })).toBe(false);
    await t.mutation(internal.codexAssignments.abandon, { ...fence, reason: "unknown" });
    expect(await t.run((ctx) => ctx.db.get(ids[0]!))).toMatchObject({ ciphertext: "replacement", generation: 2, authState: "ready", activeAssignmentId: result.assignment._id });
  });

  it("commits refresh and invalidates quota atomically before activation", async () => {
    const { t } = await setup([10]);
    const result = await t.mutation(internal.codexAssignments.reserve, attempt);
    if (result.status !== "reserved") throw new Error("expected reservation");
    const fence = { assignmentId: result.assignment._id, ownershipToken: attempt.ownershipToken, generation: 1, credentialVersion: 1 };
    await t.mutation(internal.codexAssignments.refreshStarted, fence);
    expect(await t.mutation(internal.codexAssignments.commitRefresh, { ...fence, providerAccountId: "provider-0", ciphertext: "rotated", iv: "rotated" })).toBe(true);
    expect(await t.mutation(internal.codexAssignments.activate, { ...fence, credentialVersion: 2 })).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(result.assignment._id))).toMatchObject({ phase: "reserved", credentialVersion: 2 });
  });
});
