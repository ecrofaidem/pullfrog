import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { open, seal } from "../convex/lib/crypto";

const modules = import.meta.glob("../convex/**/*.ts");
const account = {
  owner: "owner",
  repo: null,
  label: "Primary",
  providerAccountId: "subscription-one",
  ciphertext: "sealed-one",
  iv: "iv-one",
};
const scope = { owner: "owner", repo: null };

beforeEach(() => {
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
});
afterEach(() => vi.unstubAllEnvs());

describe("named Codex accounts", () => {
  it("stores encrypted values and returns only metadata to operators", async () => {
    const t = convexTest(schema, modules);
    const sealed = await seal('{"tokens":{"refresh_token":"private-refresh"}}');
    const id = await t.mutation(internal.codexAccounts.enroll, { ...account, ...sealed });
    const stored = await t.run((ctx) => ctx.db.get(id));
    expect(stored).toMatchObject({ generation: 1, credentialVersion: 1, enabled: true, authState: "ready" });
    expect(await open(stored!)).toContain("private-refresh");
    const listed = await t.query(internal.codexAccounts.list, scope);
    expect(listed).toMatchObject([{ id, label: "Primary", busy: false }]);
    expect(JSON.stringify(listed)).not.toMatch(/ciphertext|private-refresh|ownershipToken|"iv"/);
    expect(await t.query(internal.secrets.visibleTo, { owner: "owner", repo: "repo" })).toEqual([]);
  });

  it("rejects duplicate provider identities across owner scopes and memberships", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.codexAccounts.enroll, account);
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "first", accountIds: [id] });
    await expect(t.mutation(internal.codexAccounts.enroll, {
      ...account, owner: "OWNER", repo: "second", label: "Disguised duplicate",
    })).rejects.toThrow(/already enrolled/);
    await expect(t.mutation(internal.codexAccounts.enroll, {
      ...account, owner: "another-owner",
    })).resolves.toBeTruthy();
  });

  it("requires explicit membership and defaults new pools to disabled", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.codexAccounts.enroll, account);
    expect(await t.query(internal.codexAccounts.getPoolAccounts, { owner: "owner", repo: "repo" })).toEqual([]);
    expect(await t.query(internal.codexAccounts.list, { owner: "owner", repo: "repo" })).toEqual([]);
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [id] });
    expect(await t.query(internal.codexAccounts.getPool, { owner: "owner", repo: "repo" })).toMatchObject({ enabled: false, accountIds: [id] });
    expect(await t.query(internal.codexAccounts.getPoolAccounts, { owner: "owner", repo: "repo" })).toEqual([]);
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [id], enabled: true });
    expect(await t.query(internal.codexAccounts.getPoolAccounts, { owner: "owner", repo: "repo" })).toMatchObject([{ _id: id }]);
    expect(await t.query(internal.codexAccounts.getPoolAccounts, { owner: "owner", repo: "other" })).toEqual([]);
  });

  it("serializes concurrent enrollment of the same subscription", async () => {
    const t = convexTest(schema, modules);
    const outcomes = await Promise.allSettled([
      t.mutation(internal.codexAccounts.enroll, account),
      t.mutation(internal.codexAccounts.enroll, { ...account, repo: "repo" }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("codexAccounts").collect())).toHaveLength(1);
  });

  it("rejects cross-owner, cross-repository, and repeated pool members", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.codexAccounts.enroll, { ...account, repo: "private" });
    for (const candidate of [
      { owner: "other", repo: "private", accountIds: [id] },
      { owner: "owner", repo: "other", accountIds: [id] },
      { owner: "owner", repo: "private", accountIds: [id, id] },
    ]) {
      await expect(t.mutation(internal.codexAccounts.configurePool, candidate)).rejects.toThrow();
    }
    expect(await t.query(internal.codexAccounts.getPool, { owner: "owner", repo: "private" })).toBeNull();
  });

  it("preserves priority and enablement when editing a configured pool", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.codexAccounts.enroll, account);
    const second = await t.mutation(internal.codexAccounts.enroll, { ...account, providerAccountId: "subscription-two", label: "Secondary" });
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [second, first], enabled: true });
    const rows = await t.query(internal.codexAccounts.getPoolAccounts, { owner: "owner", repo: "repo" });
    expect(rows.map((row) => row._id)).toEqual([second, first]);
    await t.mutation(internal.codexAccounts.configurePool, { owner: "owner", repo: "repo", accountIds: [first, second] });
    expect(await t.query(internal.codexAccounts.getPool, { owner: "owner", repo: "repo" })).toMatchObject({ enabled: true, accountIds: [first, second] });
  });

  it("reenrolls without freeing an occupied account and fences stale writes", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.codexAccounts.enroll, account);
    await t.run((ctx) => ctx.db.patch(id, { activeAssignmentId: "assignment-one", activeOwnershipToken: "token-one" }));
    const fence = { accountId: id, generation: 1, credentialVersion: 1, assignmentId: "assignment-one", ownershipToken: "token-one" };
    await t.mutation(internal.codexAccounts.setEnabled, { ...scope, accountId: id, enabled: false });
    await t.mutation(internal.codexAccounts.replace, { ...scope, accountId: id, providerAccountId: account.providerAccountId, ciphertext: "replacement", iv: "new-iv" });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ generation: 2, credentialVersion: 1, enabled: false, activeAssignmentId: "assignment-one", activeOwnershipToken: "token-one", ciphertext: "replacement" });
    expect(await t.mutation(internal.codexAccounts.updateCredentials, { ...fence, providerAccountId: account.providerAccountId, ciphertext: "stale", iv: "stale" })).toBe(false);
    expect(await t.mutation(internal.codexAccounts.markAuthState, { ...fence, authState: "rejected" })).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ authState: "ready", ciphertext: "replacement", activeAssignmentId: "assignment-one" });
  });

  it("rejects ownership, credential-version, and provider mismatches without changing either account", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.codexAccounts.enroll, account);
    const second = await t.mutation(internal.codexAccounts.enroll, { ...account, providerAccountId: "subscription-two" });
    await t.run((ctx) => ctx.db.patch(first, { activeAssignmentId: "assignment-one", activeOwnershipToken: "token-one" }));
    const fence = { accountId: first, generation: 1, credentialVersion: 1, assignmentId: "assignment-one", ownershipToken: "token-one" };
    const write = { ...fence, providerAccountId: account.providerAccountId, ciphertext: "updated", iv: "updated-iv" };
    for (const mismatch of [{ accountId: second }, { ownershipToken: "token-two" }, { assignmentId: "assignment-two" }, { credentialVersion: 0 }, { providerAccountId: "subscription-two" }]) {
      expect(await t.mutation(internal.codexAccounts.updateCredentials, { ...write, ...mismatch })).toBe(false);
    }
    expect(await t.mutation(internal.codexAccounts.updateCredentials, write)).toBe(true);
    expect(await t.mutation(internal.codexAccounts.markAuthState, { ...fence, authState: "uncertain" })).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(second))).toMatchObject({ ciphertext: "sealed-one", credentialVersion: 1 });
    expect(await t.run((ctx) => ctx.db.get(first))).toMatchObject({ ciphertext: "updated", credentialVersion: 2, authState: "ready" });
  });

  it("allows disabled active accounts to persist their final credentials", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.codexAccounts.enroll, account);
    await t.run((ctx) => ctx.db.patch(id, { activeAssignmentId: "assignment-one", activeOwnershipToken: "token-one" }));
    await t.mutation(internal.codexAccounts.setEnabled, { ...scope, accountId: id, enabled: false });
    expect(await t.mutation(internal.codexAccounts.updateCredentials, { accountId: id, generation: 1, credentialVersion: 1, assignmentId: "assignment-one", ownershipToken: "token-one", providerAccountId: account.providerAccountId, ciphertext: "final", iv: "final-iv" })).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ enabled: false, ciphertext: "final", activeAssignmentId: "assignment-one" });
  });

  it.each(["uncertain", "rejected"] as const)("fences refresh results after marking a chain %s", async (authState) => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.codexAccounts.enroll, account);
    await t.run((ctx) => ctx.db.patch(id, { activeAssignmentId: "assignment-one", activeOwnershipToken: "token-one" }));
    const fence = { accountId: id, generation: 1, credentialVersion: 1, assignmentId: "assignment-one", ownershipToken: "token-one" };
    expect(await t.mutation(internal.codexAccounts.markAuthState, { ...fence, authState })).toBe(true);
    expect(await t.mutation(internal.codexAccounts.updateCredentials, { ...fence, providerAccountId: account.providerAccountId, ciphertext: "delayed-success", iv: "new" })).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ authState, credentialVersion: 2, ciphertext: "sealed-one", activeAssignmentId: "assignment-one" });
  });

  it("rejects replacement identity changes and mutations from another scope", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.codexAccounts.enroll, account);
    await expect(t.mutation(internal.codexAccounts.replace, { ...scope, accountId: id, providerAccountId: "different-subscription", ciphertext: "new", iv: "new" })).rejects.toThrow(/identity/);
    await expect(t.mutation(internal.codexAccounts.setEnabled, { owner: "other", repo: null, accountId: id, enabled: false })).rejects.toThrow(/scope/);
    await expect(t.mutation(internal.codexAccounts.setEnabled, { owner: "owner", repo: "repo", accountId: id, enabled: false })).rejects.toThrow(/scope/);
  });
});
