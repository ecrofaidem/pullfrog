import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { hmacSha256Hex } from "../convex/lib/crypto";
import { selectWebhook } from "../convex/lib/webhookEvent";
import worker, { type Env } from "../webhook/worker";
import * as github from "../convex/lib/github";

vi.mock("../convex/lib/github", async (original) => ({
  ...(await original<typeof import("../convex/lib/github")>()),
  findRepoInstallation: vi.fn(async () => ({ id: 1 })),
  createInstallationToken: vi.fn(async () => ({ token: "fixture-installation-token" })),
  collaboratorPermission: vi.fn(async () => "write"),
  createCheckRun: vi.fn(async () => ({ id: 10 })),
  dispatchWorkflow: vi.fn(async () => undefined),
  addReaction: vi.fn(async () => undefined),
  getPullRequest: vi.fn(async () => ({
    number: 42,
    title: "PR",
    body: "Full PR text",
    draft: false,
    head: { ref: "branch", sha: "head" },
  })),
  getWorkflowRun: vi.fn(async () => null),
}));

const modules = import.meta.glob("../convex/**/*.ts");
const env: Env = {
  GITHUB_WEBHOOK_SECRET: "fixture-webhook-signing-key",
  CONVEX_WEBHOOK_URL: "https://example.convex.site/webhooks/github",
  ACTION_WORKFLOW: "pullfrog.yml",
};
const human = { login: "alice", type: "User" };
const bot = { login: "ci[bot]", type: "Bot" };
const repository = {
  name: "repo",
  owner: { login: "owner" },
  default_branch: "main",
  unused: "x".repeat(20_000),
};
function workflow(path = ".github/workflows/pullfrog.yml") {
  return {
    action: "completed",
    repository,
    sender: bot,
    workflow_run: {
      id: 123,
      path,
      name: "Pullfrog",
      display_title: "prfrog: review #42 · abcdef12",
      html_url: "https://github.com/owner/repo/actions/runs/123",
      conclusion: "success",
      run_attempt: 1,
      head_repository: repository,
    },
  };
}
function pullRequest(action = "opened") {
  return {
    action,
    repository,
    sender: human,
    before: "before",
    pull_request: {
      number: 42,
      title: "PR",
      body: "Full PR text",
      draft: false,
      user: human,
      head: { ref: "branch", sha: "head", repo: repository },
      base: { repo: repository },
    },
  };
}
function comment(body = "@custom-handle review this") {
  return {
    action: "created",
    repository,
    issue: { number: 42, pull_request: { url: "unused" } },
    comment: { id: 24, body, user: human },
  };
}
async function request(event: string, payload: unknown, delivery = "fixture-delivery") {
  const body = JSON.stringify(payload);
  return new Request("https://receiver.example/webhooks/github", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": delivery,
      "x-hub-signature-256": `sha256=${await hmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, body)}`,
    },
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", env.GITHUB_WEBHOOK_SECRET);
  vi.stubEnv("ACTION_WORKFLOW", env.ACTION_WORKFLOW);
  vi.stubEnv("DEFAULT_REVIEW_AUTHORS", "alice");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external request");
    }),
  );
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("webhook ingestion", () => {
  it.each([
    ["workflow_run", workflow(".github/workflows/dashboard.yml")],
    ["pull_request", pullRequest("edited")],
    [
      "pull_request",
      { ...pullRequest(), pull_request: { ...pullRequest().pull_request, draft: true } },
    ],
    ["pull_request", { ...pullRequest("synchronize"), sender: bot }],
    ["pull_request", { ...pullRequest("synchronize"), sender: undefined }],
    [
      "pull_request",
      { ...pullRequest(), pull_request: { ...pullRequest().pull_request, user: bot } },
    ],
    ["issue_comment", { ...comment(), action: "edited" }],
    ["issue_comment", comment("Normal discussion")],
    ["issue_comment", { ...comment(), comment: { ...comment().comment, user: bot } }],
    ["issue_comment", { ...comment(), issue: { number: 42 } }],
    ["push", {}],
  ])("ignores %s before any upstream call or database write", async (event, payload) => {
    const t = convexTest(schema, modules);
    const req = await request(event, payload);
    expect((await worker.fetch(req.clone(), env)).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    // The direct Convex endpoint has the same defense during rollout or rollback.
    expect(
      (
        await t.fetch("/webhooks/github", {
          method: "POST",
          headers: req.headers,
          body: await req.text(),
        })
      ).status,
    ).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("webhookDeliveries").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  it("keeps signed bytes at the Worker and schedules only a compact event, once", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => t.fetch("/webhooks/github", init)),
    );
    const req = await request("workflow_run", workflow());
    const raw = await req.clone().text();
    expect((await worker.fetch(req.clone(), env)).status).toBe(202);
    expect((await worker.fetch(req.clone(), env)).status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      env.CONVEX_WEBHOOK_URL,
      expect.objectContaining({ body: raw, redirect: "manual" }),
    );
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
    expect(JSON.stringify(scheduled[0].args).length).toBeLessThan(1000);
    expect(JSON.stringify(scheduled[0].args)).not.toContain("unused");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const runs = await t.run((ctx) => ctx.db.query("runs").collect());
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ githubRunId: 123, status: "completed", conclusion: "success" });
  });

  it("rolls back the delivery claim when scheduling fails", async () => {
    const t = convexTest({ schema, modules, transactionLimits: { functionsScheduled: 0 } });
    await expect(
      t.mutation(internal.webhooks.accept, {
        delivery: "rollback",
        ...selectWebhook("workflow_run", workflow(), "pullfrog.yml")!,
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("webhookDeliveries").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  it("rejects invalid signatures before filtering", async () => {
    const req = await request("workflow_run", workflow("unrelated.yml"));
    req.headers.set("x-hub-signature-256", "sha256=invalid");
    expect((await worker.fetch(req, env)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not acknowledge an upstream failure or timeout", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    expect((await worker.fetch(await request("workflow_run", workflow()), env)).status).toBe(503);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timeout"));
    expect((await worker.fetch(await request("workflow_run", workflow()), env)).status).toBe(503);
  });

  it("rejects upstream redirects without forwarding the signed body elsewhere", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: "https://other.example" } }),
    );
    expect((await worker.fetch(await request("workflow_run", workflow()), env)).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      env.CONVEX_WEBHOOK_URL,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("preserves long review text and custom handles without truncation", () => {
    const body = "@my.custom-handle review\n" + "ä\n".repeat(30_000);
    const selected = selectWebhook("issue_comment", comment(body), "pullfrog.yml");
    expect(selected?.event).toBe("issue_comment");
    if (selected?.event === "issue_comment") expect(selected.payload.comment.body).toBe(body);
    expect(
      selectWebhook("workflow_run", workflow(".github/workflows/other.yml"), "other.yml"),
    ).not.toBeNull();
    expect(
      selectWebhook(
        "pull_request",
        { ...pullRequest("ready_for_review"), sender: bot },
        "pullfrog.yml",
      ),
    ).not.toBeNull();
  });

  it.each(["opened", "synchronize", "ready_for_review"])(
    "dispatches a compact %s review with the original envelope",
    async (action) => {
      const t = convexTest(schema, modules);
      await t.mutation(internal.actionVersion.set, {
        repo: "ecrofaidem/pullfrog@main",
        version: "0.1.67",
      });
      const req = await request("pull_request", pullRequest(action));
      expect(
        (
          await t.fetch("/webhooks/github", {
            method: "POST",
            headers: req.headers,
            body: await req.text(),
          })
        ).status,
      ).toBe(202);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(github.dispatchWorkflow).toHaveBeenCalledTimes(1);
      const args = vi.mocked(github.dispatchWorkflow).mock.calls[0][0];
      const envelope = JSON.parse(args.inputs.prompt);
      expect(envelope.event).toMatchObject({
        title: "PR",
        body: "Full PR text",
        branch: "branch",
        issue_number: 42,
      });
      if (action === "synchronize") expect(envelope.event.before_sha).toBe("before");
    },
  );

  it("keeps exact handle and collaborator checks in the backend", async () => {
    const t = convexTest(schema, modules);
    const id = (await t.mutation(internal.repos.ensure, { owner: "owner", name: "repo" }))._id;
    await t.run((ctx) => ctx.db.patch(id, { handle: "custom-handle" }));
    await t.mutation(internal.actionVersion.set, {
      repo: "ecrofaidem/pullfrog@main",
      version: "0.1.67",
    });
    await t.action(internal.dispatch.handleEvent, {
      delivery: "mention",
      ...selectWebhook("issue_comment", comment(), "pullfrog.yml")!,
    });
    expect(github.dispatchWorkflow).toHaveBeenCalledTimes(1);
    vi.mocked(github.collaboratorPermission).mockResolvedValueOnce("read");
    await t.action(internal.dispatch.handleEvent, {
      delivery: "no-permission",
      ...selectWebhook("issue_comment", comment(), "pullfrog.yml")!,
    });
    await t.action(internal.dispatch.handleEvent, {
      delivery: "other-handle",
      ...selectWebhook("issue_comment", comment("@another review"), "pullfrog.yml")!,
    });
    expect(github.dispatchWorkflow).toHaveBeenCalledTimes(1);
  });

  it("preserves installation and repository membership changes", async () => {
    const t = convexTest(schema, modules);
    const installation = {
      id: 1,
      account: { login: "owner", type: "Organization" },
      repository_selection: "selected",
      suspended_at: null,
      unused: repository,
    };
    const created = selectWebhook(
      "installation",
      {
        action: "created",
        installation,
        repositories: [{ full_name: "owner/repo", unused: repository }],
      },
      "pullfrog.yml",
    )!;
    expect(JSON.stringify(created).length).toBeLessThan(400);
    await t.action(internal.dispatch.handleEvent, { ...created, delivery: "installed" });
    expect(await t.query(internal.repos.getInstallation, { owner: "owner" })).toMatchObject({
      installationId: 1,
      isOrg: true,
      suspended: false,
    });
    expect(await t.query(internal.repos.get, { owner: "owner", name: "repo" })).toMatchObject({
      enabled: true,
    });
    const changed = selectWebhook(
      "installation_repositories",
      {
        action: "removed",
        installation,
        repositories_removed: [{ name: "repo" }],
        repositories_added: [{ name: "another" }],
      },
      "pullfrog.yml",
    )!;
    await t.action(internal.dispatch.handleEvent, { ...changed, delivery: "membership" });
    expect(await t.query(internal.repos.get, { owner: "owner", name: "repo" })).toMatchObject({
      enabled: false,
    });
    expect(await t.query(internal.repos.get, { owner: "owner", name: "another" })).toMatchObject({
      enabled: true,
    });
  });
});

describe("retention and run lifecycle", () => {
  it("reconciles a legacy row against GitHub before applying an older attempt", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("runs", {
        owner: "owner",
        repo: "repo",
        githubRunId: 123,
        dispatchId: "abcdef12",
        title: "Legacy",
        kind: "review",
        trigger: "manual",
        status: "completed",
        conclusion: "success",
        createdAt: Date.now() - 100_000,
        updatedAt: Date.now() - 1000,
        completedAt: Date.now() - 1000,
      }),
    );
    const current = {
      id: 123,
      name: "Pullfrog",
      display_title: "prfrog: review #42 · abcdef12",
      html_url: "url",
      status: "in_progress",
      conclusion: null,
      run_attempt: 3,
    };
    vi.mocked(github.getWorkflowRun).mockResolvedValueOnce(current);
    const event = {
      delivery: "legacy",
      ...selectWebhook("workflow_run", workflow(), "pullfrog.yml")!,
    };
    await t.action(internal.dispatch.handleEvent, event);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      githubRunAttempt: 3,
      status: "in_progress",
    });
    await t.action(internal.dispatch.handleEvent, { ...event, delivery: "older-again" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("in_progress");
    expect(github.getWorkflowRun).toHaveBeenCalledTimes(1);
  });

  it("retries a failed current-state lookup without applying unverified legacy state", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("runs", {
        owner: "owner",
        repo: "repo",
        githubRunId: 123,
        dispatchId: "abcdef12",
        title: "Legacy",
        kind: "review",
        trigger: "manual",
        status: "in_progress",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    vi.mocked(github.getWorkflowRun)
      .mockRejectedValueOnce(new Error("temporary GitHub outage"))
      .mockResolvedValueOnce({
        id: 123,
        name: "Pullfrog",
        display_title: "prfrog: review #42 · abcdef12",
        html_url: "url",
        status: "completed",
        conclusion: "cancelled",
        run_attempt: 2,
      });
    await t.action(internal.dispatch.handleEvent, {
      delivery: "retry",
      ...selectWebhook("workflow_run", workflow(), "pullfrog.yml")!,
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.githubRunAttempt).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("in_progress");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      githubRunAttempt: 2,
      status: "cancelled",
    });
    expect(github.getWorkflowRun).toHaveBeenCalledTimes(2);
  });

  it("expires delivery IDs in batches without deleting review history or recent IDs", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    vi.setSystemTime(now - 8 * 24 * 60 * 60 * 1000);
    await t.run(async (ctx) => {
      for (let i = 0; i < 501; i++)
        await ctx.db.insert("webhookDeliveries", { deliveryId: String(i), receivedAt: Date.now() });
    });
    await t.mutation(internal.runs.recordDispatch, {
      owner: "owner",
      repo: "repo",
      dispatchId: "retained",
      kind: "review",
      trigger: "manual",
      title: "Keep history",
    });
    vi.setSystemTime(now);
    await t.run((ctx) =>
      ctx.db.insert("webhookDeliveries", { deliveryId: "recent", receivedAt: now }),
    );
    expect(await t.mutation(internal.webhooks.expireDeliveries, {})).toEqual({ deleted: 500 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      (await t.run((ctx) => ctx.db.query("webhookDeliveries").collect())).map((d) => d.deliveryId),
    ).toEqual(["recent"]);
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(1);
  });

  it("does not scan completed history to find overdue open runs", async () => {
    const t = convexTest({ schema, modules, transactionLimits: { documentsRead: 50 } });
    await t.mutation(internal.repos.ensure, { owner: "owner", name: "repo" });
    const old = Date.now() - 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const base = {
        owner: "owner",
        repo: "repo",
        kind: "review",
        trigger: "manual",
        title: "History",
        createdAt: old,
        updatedAt: old,
      };
      for (let i = 0; i < 200; i++) await ctx.db.insert("runs", { ...base, status: "completed" });
      await ctx.db.insert("runs", { ...base, status: "in_progress" });
      await ctx.db.insert("runs", { ...base, status: "queued", createdAt: Date.now() });
    });
    expect(await t.mutation(internal.runs.sweepStale, {})).toEqual({ swept: 1 });
  });

  it("preserves terminal status, accepts a new attempt, and ignores old-attempt events", async () => {
    const t = convexTest(schema, modules);
    const args = {
      owner: "owner",
      repo: "repo",
      githubRunId: 123,
      htmlUrl: "url",
      title: "Manual",
      githubRunAttempt: 1,
    };
    const id = await t.mutation(internal.runs.observeWorkflowRun, {
      ...args,
      status: "completed",
      conclusion: "success",
    });
    await t.mutation(internal.runs.observeWorkflowRun, { ...args, status: "in_progress" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("completed");
    vi.advanceTimersByTime(1000);
    await t.mutation(internal.runs.observeWorkflowRun, {
      ...args,
      githubRunAttempt: 2,
      status: "queued",
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      status: "queued",
      githubRunAttempt: 2,
      createdAt: Date.now(),
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.completedAt).toBeUndefined();
    await t.mutation(internal.runs.observeWorkflowRun, {
      ...args,
      status: "completed",
      conclusion: "failure",
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("queued");
    await t.mutation(internal.runs.observeWorkflowRun, {
      ...args,
      githubRunAttempt: 2,
      status: "cancelled",
      conclusion: "cancelled",
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("cancelled");
  });

  it("does not rewrite identical callbacks or lifecycle updates", async () => {
    const t = convexTest(schema, modules);
    const args = {
      owner: "owner",
      repo: "repo",
      githubRunId: 123,
      htmlUrl: "url",
      title: "Manual",
      status: "completed" as const,
      conclusion: "success",
    };
    const id = await t.mutation(internal.runs.observeWorkflowRun, args);
    const first = await t.run((ctx) => ctx.db.get(id));
    vi.advanceTimersByTime(1000);
    await t.mutation(internal.runs.observeWorkflowRun, args);
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(first);
    await t.mutation(internal.runs.patchFromAction, {
      owner: "owner",
      repo: "repo",
      githubRunId: 123,
      fields: { inputTokens: 100 },
    });
    const patched = await t.run((ctx) => ctx.db.get(id));
    vi.advanceTimersByTime(1000);
    await t.mutation(internal.runs.patchFromAction, {
      owner: "owner",
      repo: "repo",
      githubRunId: 123,
      fields: { inputTokens: 100 },
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(patched);
  });
});
