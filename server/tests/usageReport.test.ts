import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const repo = { owner: "owner", repo: "repo" };
const resetAt = Math.floor(Date.now() / 1000) + 3600;
const weekly = (usedPercent: number) => ({
  status: usedPercent < 100 ? "available" as const : "exhausted" as const,
  weekly: { plan: "pro", usedPercent, windowSeconds: 604800, resetAt },
});

async function setup() {
  const t = convexTest(schema, modules);
  const accountId = await t.mutation(internal.codexAccounts.enroll, {
    owner: "owner", repo: null, label: "Main", providerAccountId: "provider", ciphertext: "c", iv: "iv",
  });
  await t.mutation(internal.codexAccounts.configurePool, { ...repo, accountIds: [accountId], enabled: true });
  const record = (observedAt: number, result: Parameters<typeof weekly>[0] | { status: "authentication" }) =>
    t.mutation(internal.codexQuota.record, {
      accountId, generation: 1, credentialVersion: 1, observedAt,
      result: typeof result === "number" ? weekly(result) : result,
    });
  return { t, accountId, record };
}

describe("quota sample history", () => {
  it("keeps changes and a half-hourly heartbeat, never auth failures", async () => {
    const { t, record } = await setup();
    const now = Date.now();
    await record(now - 50 * 60_000, 10);
    await record(now - 45 * 60_000, 10);
    await record(now - 40 * 60_000, 12);
    await record(now - 35 * 60_000, { status: "authentication" });
    await record(now - 5 * 60_000, 12);
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.accounts[0]!.samples.map((s) => s.usedPercent)).toEqual([10, 12, 12]);
    expect(report.accounts[0]).toMatchObject({ label: "Main", plan: "pro" });
    expect(report.accounts[0]!.samples[0]!.resetAt).toBe(resetAt * 1000);
  });
});

describe("denials", () => {
  it("does not offer an account whose login was rejected", async () => {
    const { t, accountId } = await setup();
    await t.run((ctx) => ctx.db.patch(accountId, { authState: "rejected" }));
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.accounts[0]!.enabled).toBe(false);
  });

  it("records a denial without figures as a closed reading of the last window", async () => {
    const { t, record } = await setup();
    await record(Date.now() - 60_000, 30);
    await t.mutation(internal.codexQuota.record, {
      accountId: (await t.run((ctx) => ctx.db.query("codexAccounts").first()))!._id,
      generation: 1, credentialVersion: 1, observedAt: Date.now(), result: { status: "provider_denied" },
    });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.accounts[0]!.samples.map((s) => [s.usedPercent, s.status])).toEqual([[30, "available"], [30, "provider_denied"]]);
  });
});

describe("run usage fields", () => {
  it("links a patched run to the account it was activated on and its starting quota", async () => {
    const { t, accountId, record } = await setup();
    await record(Date.now(), 10);
    const attempt = { ...repo, runId: "77", runAttempt: "1", runtimeInstance: "i", ownershipToken: "token", excludedIds: [] };
    const reserved = await t.mutation(internal.codexAssignments.reserve, attempt);
    if (reserved.status !== "reserved") throw new Error("expected reservation");
    await t.mutation(internal.codexAssignments.activate, {
      assignmentId: reserved.assignment._id, ownershipToken: "token", generation: 1, credentialVersion: 1,
    });
    await t.mutation(internal.runs.patchFromAction, {
      ...repo, githubRunId: 77,
      fields: { inputTokens: 900, outputTokens: 100, codexSpeed: "ultrafast", codexSubagents: 3, quotaEndPercent: 14 },
    });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs).toMatchObject([{
      accountId, quotaStart: 10, quotaEnd: 14, speed: "ultrafast", subagents: 3, tokens: 1000,
    }]);
  });

  it("drops an impossible end percentage", async () => {
    const { t } = await setup();
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 5, fields: { quotaEndPercent: 140 } });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs[0]!.quotaEnd).toBeUndefined();
  });
});

describe("run attribution", () => {
  async function activate(t: Awaited<ReturnType<typeof setup>>["t"], runAttempt: string, token: string) {
    const reserved = await t.mutation(internal.codexAssignments.reserve, {
      ...repo, runId: "88", runAttempt, runtimeInstance: `i-${runAttempt}`, ownershipToken: token, excludedIds: [],
    });
    if (reserved.status !== "reserved") throw new Error("expected reservation");
    await t.mutation(internal.codexAssignments.activate, {
      assignmentId: reserved.assignment._id, ownershipToken: token, generation: 1, credentialVersion: 1,
    });
    // the run finished: free the account for the next attempt
    await t.run((ctx) => ctx.db.patch(reserved.account._id, { activeAssignmentId: undefined, activeOwnershipToken: undefined }));
    return reserved.account._id;
  }

  it("keeps attribution when an early PATCH row is folded into its dispatch", async () => {
    const { t, accountId, record } = await setup();
    await record(Date.now(), 20);
    await activate(t, "1", "tok-1");
    await t.mutation(internal.runs.recordDispatch, { ...repo, dispatchId: "d1", kind: "review", trigger: "pull_request_opened", title: "t" });
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { inputTokens: 5 } });
    await t.mutation(internal.runs.observeWorkflowRun, {
      ...repo, dispatchId: "d1", githubRunId: 88, githubRunAttempt: 1, currentAttemptVerified: true,
      htmlUrl: "https://example.test/run", title: "t", status: "in_progress",
    });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({ accountId, quotaStart: 20, tokens: 5 });
    expect(report.accounts[0]).toMatchObject({ servedRuns: 1, servedTokens: 5 });
  });

  it("keeps a rerun's attribution when its PATCH beats the webhook", async () => {
    const { t, accountId, record } = await setup();
    await record(Date.now(), 20);
    await t.mutation(internal.runs.recordDispatch, { ...repo, dispatchId: "d3", kind: "review", trigger: "pull_request_opened", title: "t" });
    const observe = (attempt: number) => t.mutation(internal.runs.observeWorkflowRun, {
      ...repo, dispatchId: "d3", githubRunId: 88, githubRunAttempt: attempt, currentAttemptVerified: true,
      htmlUrl: "https://example.test/run", title: "t", status: "in_progress",
    });
    await observe(1);
    await activate(t, "2", "tok-2");
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { quotaEndPercent: 25, codexSpeed: "ultrafast" } });
    await observe(2);
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs[0]).toMatchObject({ accountId, quotaEnd: 25, speed: "ultrafast" });
  });

  it("flags runs that shared an account at the same time, across repos", async () => {
    const { t, accountId } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const [r, start, end] of [["repo", now - 50_000, now - 20_000], ["other", now - 40_000, now - 30_000], ["repo", now - 10_000, now - 5_000]] as const) {
        const runId = await ctx.db.insert("runs", { owner: "owner", repo: r, kind: "review", trigger: "t", title: "t", status: "completed", createdAt: start, updatedAt: end, completedAt: end });
        await ctx.db.insert("runUsage", { runId, owner: "owner", repo: r, createdAt: start, completedAt: end, status: "completed", kind: "review", tokens: 1, codexAccountId: accountId });
      }
    });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs.map((r) => r.overlapped)).toEqual([true, false]);
    expect(report.accounts[0]).toMatchObject({ servedRuns: 3, servedTokens: 3 });
  });

  it("does not restore an older attempt's account on a later PATCH", async () => {
    const { t, record } = await setup();
    await record(Date.now(), 20);
    await activate(t, "1", "tok-1");
    await t.mutation(internal.runs.recordDispatch, { ...repo, dispatchId: "d4", kind: "review", trigger: "pull_request_opened", title: "t" });
    const observe = (attempt: number) => t.mutation(internal.runs.observeWorkflowRun, {
      ...repo, dispatchId: "d4", githubRunId: 88, githubRunAttempt: attempt, currentAttemptVerified: true,
      htmlUrl: "https://example.test/run", title: "t", status: "in_progress",
    });
    await observe(1);
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { model: "m" } });
    await observe(2);
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { model: "m2" } });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs[0]!.accountId).toBeUndefined();
  });

  it("drops the previous attempt's figures when a rerun's PATCH arrives first", async () => {
    const { t, record } = await setup();
    await record(Date.now(), 50);
    await activate(t, "1", "tok-1");
    await t.mutation(internal.runs.recordDispatch, { ...repo, dispatchId: "d6", kind: "review", trigger: "pull_request_opened", title: "t" });
    await t.mutation(internal.runs.observeWorkflowRun, {
      ...repo, dispatchId: "d6", githubRunId: 88, githubRunAttempt: 1, currentAttemptVerified: true,
      htmlUrl: "https://example.test/run", title: "t", status: "in_progress",
    });
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { runAttempt: 1, quotaEndPercent: 60, codexSpeed: "fast" } });
    await activate(t, "2", "tok-2");
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { runAttempt: 2, model: "m" } });
    // a delayed attempt-1 report after attempt 2 took over changes nothing
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { runAttempt: 1, quotaEndPercent: 70, inputTokens: 900 } });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect([report.runs[0]!.quotaEnd, report.runs[0]!.speed, report.runs[0]!.tokens]).toEqual([undefined, undefined, 0]);
  });

  it("rejects a stale report before the webhook links the run, and clears untagged older tokens", async () => {
    const { t, record } = await setup();
    await record(Date.now(), 20);
    await activate(t, "2", "tok-2");
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { runAttempt: 1, inputTokens: 700 } });
    let report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs).toHaveLength(0);

    await t.mutation(internal.runs.recordDispatch, { ...repo, dispatchId: "d7", kind: "review", trigger: "pull_request_opened", title: "t" });
    const observe = (attempt: number) => t.mutation(internal.runs.observeWorkflowRun, {
      ...repo, dispatchId: "d7", githubRunId: 77, githubRunAttempt: attempt, currentAttemptVerified: true,
      htmlUrl: "https://example.test/run", title: "t", status: "in_progress",
    });
    await observe(1);
    // an attempt with no pooled account still tags its tokens, so the rerun drops them
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 77, fields: { inputTokens: 1000 } });
    await observe(2);
    report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs[0]!.tokens).toBe(0);
  });

  it("ignores a late PATCH from an older attempt", async () => {
    const { t, record } = await setup();
    await record(Date.now(), 20);
    await t.mutation(internal.runs.recordDispatch, { ...repo, dispatchId: "d5", kind: "review", trigger: "pull_request_opened", title: "t" });
    await t.mutation(internal.runs.observeWorkflowRun, {
      ...repo, dispatchId: "d5", githubRunId: 88, githubRunAttempt: 2, currentAttemptVerified: true,
      htmlUrl: "https://example.test/run", title: "t", status: "in_progress",
    });
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { runAttempt: 2, quotaEndPercent: 40 } });
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { runAttempt: 1, quotaEndPercent: 90 } });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect(report.runs[0]!.quotaEnd).toBe(40);
  });

  it("finds the pool and assignments of a repo named with capitals", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.mutation(internal.codexAccounts.enroll, {
      owner: "Owner", repo: null, label: "Main", providerAccountId: "p", ciphertext: "c", iv: "iv",
    });
    await t.mutation(internal.codexAccounts.configurePool, { owner: "Owner", repo: "MyRepo", accountIds: [accountId], enabled: true });
    await t.mutation(internal.codexQuota.record, { accountId, generation: 1, credentialVersion: 1, observedAt: Date.now(), result: weekly(10) });
    const reserved = await t.mutation(internal.codexAssignments.reserve, {
      owner: "Owner", repo: "MyRepo", runId: "99", runAttempt: "1", runtimeInstance: "i", ownershipToken: "tok", excludedIds: [],
    });
    if (reserved.status !== "reserved") throw new Error("expected reservation");
    await t.mutation(internal.codexAssignments.activate, { assignmentId: reserved.assignment._id, ownershipToken: "tok", generation: 1, credentialVersion: 1 });
    await t.mutation(internal.runs.patchFromAction, { owner: "Owner", repo: "MyRepo", githubRunId: 99, fields: { inputTokens: 1 } });
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, { owner: "Owner", repo: "MyRepo" });
    expect(report.poolEnabled).toBe(true);
    expect(report.runs[0]).toMatchObject({ accountId, quotaStart: 10 });
  });

  it("clears attribution when GitHub starts a new attempt", async () => {
    const { t, record } = await setup();
    await record(Date.now(), 20);
    await activate(t, "1", "tok-1");
    await t.mutation(internal.runs.recordDispatch, { ...repo, dispatchId: "d2", kind: "review", trigger: "pull_request_opened", title: "t" });
    const observe = (attempt: number) => t.mutation(internal.runs.observeWorkflowRun, {
      ...repo, dispatchId: "d2", githubRunId: 88, githubRunAttempt: attempt, currentAttemptVerified: true,
      htmlUrl: "https://example.test/run", title: "t", status: "in_progress",
    });
    await observe(1);
    await t.mutation(internal.runs.patchFromAction, { ...repo, githubRunId: 88, fields: { quotaEndPercent: 30 } });
    await observe(2);
    const report = await t.withIdentity({ subject: "operator" }).query(api.usageReport.get, repo);
    expect([report.runs[0]!.accountId, report.runs[0]!.quotaStart, report.runs[0]!.quotaEnd]).toEqual([undefined, undefined, undefined]);
  });
});
