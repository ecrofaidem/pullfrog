import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { getPullRequest } from "../convex/lib/github";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { parseDeliveries, retryableDeliveries, type Delivery } from "../convex/lib/webhookRecovery";

vi.mock("../convex/lib/github", () => ({
  appJwt: vi.fn(async () => "fixture-app-token"),
  findRepoInstallation: vi.fn(async () => ({ id: 1 })),
  createInstallationToken: vi.fn(async () => ({ token: "fixture-installation-token" })),
  getPullRequest: vi.fn(async () => ({ state: "closed", draft: false, head: { sha: "head" } })),
}));
const now = Date.now();
function delivery(id: number, patch: Partial<Delivery> = {}): Delivery {
  return {
    id: String(id),
    guid: String(id),
    status_code: 503,
    delivered_at: new Date(now - 120_000).toISOString(),
    redelivery: false,
    ...patch,
  };
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([false, true])(
  "recovers a general comment without treating it as an automatic PR review (PR: %s)",
  async (isPr) => {
    vi.stubEnv("ACTION_WORKFLOW", "pullfrog.yml");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push(`${init?.method} ${path}`);
        if (path === "/app/hook/deliveries") return Response.json([delivery(1)]);
        if (path === "/app/hook/deliveries/1")
          return Response.json({
            event: "issue_comment",
            request: {
              payload: {
                action: "created",
                repository: { name: "repo", owner: { login: "owner" } },
                issue: {
                  number: 42,
                  title: "Docs",
                  body: "Context",
                  ...(isPr ? { pull_request: {} } : {}),
                },
                comment: {
                  id: 24,
                  body: "@prfrog please fix the docs",
                  user: { login: "alice", type: "User" },
                },
              },
            },
          });
        if (path === "/app/hook/deliveries/1/attempts") return new Response(null, { status: 202 });
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
    expect(await t.action(internal.webhookRecovery.redeliverFailed, {})).toEqual({
      inspected: 1,
      retried: 1,
      skipped: 0,
      complete: true,
    });
    expect(getPullRequest).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
      "POST /app/hook/deliveries/1/attempts",
    ]);
  },
);

it.each(["installation", "installation_repositories"])(
  "does not replay a stale %s transition",
  async (event) => {
    vi.stubEnv("ACTION_WORKFLOW", "pullfrog.yml");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        expect(init?.method).toBe("GET");
        const path = new URL(String(input)).pathname;
        if (path === "/app/hook/deliveries") return Response.json([delivery(1)]);
        return Response.json({
          event,
          request: {
            payload: {
              action: "deleted",
              installation: { id: 1, account: { login: "owner", type: "Organization" } },
              repositories_removed: [{ name: "repo" }],
            },
          },
        });
      }),
    );
    const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
    expect(await t.action(internal.webhookRecovery.redeliverFailed, {})).toEqual({
      inspected: 1,
      retried: 0,
      skipped: 1,
      complete: true,
    });
  },
);

it("retries only recent transient failures, with a finite attempt limit", () => {
  const rows = [
    delivery(1),
    delivery(2, { status_code: 0 }),
    delivery(3, { status_code: null }),
    delivery(4, { status_code: 401 }),
    delivery(5, { status_code: 202 }),
    delivery(6, { delivered_at: new Date(now - 31 * 60_000).toISOString() }),
    delivery(7),
    delivery(8, { guid: "7", redelivery: true, status_code: 200 }),
    delivery(9),
    delivery(10, { guid: "9", redelivery: true }),
    delivery(11, { guid: "9", redelivery: true }),
    delivery(12, { redelivery: true }),
    delivery(13, { delivered_at: new Date(now).toISOString() }),
  ];
  expect(retryableDeliveries(rows, now).map((d) => d.id)).toEqual(["1", "2", "3"]);
});

it("preserves real 64-bit delivery IDs without changing JSON string contents", () => {
  const source =
    '[{"id":3841685205328879616,"guid":"3841685205328879616","duration":0.27,"status":"failed \\"id\\": 3841685205328879616"},{"id":123}]';
  const rows = parseDeliveries(source);
  expect(rows[0]).toMatchObject({
    id: "3841685205328879616",
    guid: "3841685205328879616",
    duration: 0.27,
    status: 'failed "id": 3841685205328879616',
  });
  expect(rows[1]?.id).toBe("123");
});

it("follows pagination and redelivers relevant failures without replaying accepted or obsolete reviews", async () => {
  vi.stubEnv("ACTION_WORKFLOW", "pullfrog.yml");
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method} ${url.pathname}${url.search}`);
      if (url.search.includes("cursor="))
        return Response.json([
          delivery(10, { guid: "1", redelivery: true, status_code: 202 }),
          delivery(20, { delivered_at: new Date(now - 31 * 60_000).toISOString() }),
        ]);
      if (url.pathname === "/app/hook/deliveries")
        return Response.json([delivery(1), delivery(2), delivery(3)], {
          headers: {
            link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=next>; rel="next"',
          },
        });
      if (url.pathname === "/app/hook/deliveries/2")
        return Response.json({
          event: "workflow_run",
          request: {
            payload: {
              action: "completed",
              repository: { name: "repo", owner: { login: "owner" } },
              workflow_run: { id: 123, path: ".github/workflows/pullfrog.yml", run_attempt: 1 },
            },
          },
        });
      if (url.pathname === "/app/hook/deliveries/3")
        return Response.json({
          event: "pull_request",
          request: {
            payload: {
              action: "opened",
              repository: { name: "repo", owner: { login: "owner" } },
              sender: { login: "alice", type: "User" },
              pull_request: {
                number: 42,
                user: { login: "alice", type: "User" },
                head: { sha: "head" },
              },
            },
          },
        });
      if (url.pathname === "/app/hook/deliveries/2/attempts")
        return new Response(null, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    }),
  );
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  expect(await t.action(internal.webhookRecovery.redeliverFailed, {})).toEqual({
    inspected: 5,
    retried: 1,
    skipped: 1,
    complete: true,
  });
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
    "POST /app/hook/deliveries/2/attempts",
  ]);
});
