import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexPoolAssignment } from "./codexPoolProtocol.ts";

const mocks = vi.hoisted(() => ({ state: "", apiFetch: vi.fn(), warning: vi.fn() }));
vi.mock("@actions/core", () => ({
  saveState: (name: string, value: string) => { if (name === "oauth_writeback") mocks.state = value; },
  getState: () => mocks.state, setSecret: vi.fn(), info: vi.fn(), warning: mocks.warning,
}));
vi.mock("./apiFetch.ts", () => ({ apiFetch: mocks.apiFetch }));

const assignment: CodexPoolAssignment = {
  status: "assigned", version: 1, assignmentId: "assignment-1", capability: "c".repeat(64),
  accountAlias: "Account 1", generation: 1, runAttempt: "1", runtimeInstance: "instance-1",
};
const rotated = JSON.stringify({ auth_mode: "chatgpt", tokens: {
  access_token: "new-access", refresh_token: "new-refresh", account_id: "provider-1",
} });
let directory: string;
let pool: typeof import("./codexPool.ts");
let post: typeof import("./oauthWriteback.ts");
beforeEach(async () => {
  vi.resetModules(); mocks.state = ""; mocks.apiFetch.mockReset(); mocks.warning.mockReset();
  mocks.apiFetch.mockImplementation(async () => Response.json({ status: "released" }));
  directory = mkdtempSync(join(tmpdir(), "pullfrog-pool-cleanup-test-"));
  pool = await import("./codexPool.ts"); post = await import("./oauthWriteback.ts");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("pooled native process cleanup", () => {
  it("transfers the last auth file from main state to post and uses only the assignment capability", async () => {
    pool.rememberCodexPoolAssignment(assignment, "generic-token");
    const authPath = join(directory, "auth.json");
    expect(pool.registerCodexPoolAuth(authPath)).toBe(true);
    pool.markCodexPoolChild("running");
    writeFileSync(authPath, rotated);
    pool.markCodexPoolChild("stopped");
    // The post hook runs in a new process with only GHA's serialized state.
    vi.resetModules(); post = await import("./oauthWriteback.ts");
    await post.runOAuthWriteback();
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/runtime/codex-pool", method: "POST",
      headers: expect.objectContaining({ authorization: `Bearer ${assignment.capability}` }),
      body: JSON.stringify({ assignmentId: assignment.assignmentId, childStopped: true,
        auth: { kind: "snapshot", value: rotated } }),
    }));
  });

  it("releases an assignment even if startup failed before the auth path or API token arrived", async () => {
    pool.rememberCodexPoolAssignment(assignment, "");
    await post.runOAuthWriteback();
    expect(JSON.parse(mocks.apiFetch.mock.calls[0]![0].body).auth).toEqual({ kind: "unchanged" });
  });

  it("refuses API-key fallback when pooled subscription installation failed", () => {
    pool.rememberCodexPoolAssignment(assignment, "token");
    expect(() => pool.registerCodexPoolAuth()).toThrow("Codex pool auth installation failed");
  });

  it("holds occupancy while the child may still be writing and refuses another native child", async () => {
    pool.rememberCodexPoolAssignment(assignment, "token");
    pool.registerCodexPoolAuth(join(directory, "auth.json"));
    pool.markCodexPoolChild("running");
    expect(() => pool.markCodexPoolChild("running")).toThrow();
    await post.runOAuthWriteback();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it.each([null, "{partial", "{}"])("reports uncertain auth after close when the last file is %s", async (contents) => {
    pool.rememberCodexPoolAssignment(assignment, "token");
    const authPath = join(directory, "auth.json");
    pool.registerCodexPoolAuth(authPath); pool.markCodexPoolChild("running");
    if (contents !== null) writeFileSync(authPath, contents);
    pool.markCodexPoolChild("stopped");
    await post.runOAuthWriteback();
    expect(JSON.parse(mocks.apiFetch.mock.calls[0]![0].body).auth).toEqual({ kind: "uncertain" });
  });

  it("retries the identical finalization after a lost acknowledgement", async () => {
    pool.rememberCodexPoolAssignment(assignment, "token");
    mocks.apiFetch.mockRejectedValueOnce(new Error("lost response"));
    await post.runOAuthWriteback();
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(mocks.apiFetch.mock.calls[0]![0].body).toBe(mocks.apiFetch.mock.calls[1]![0].body);
  });

  it("keeps the persisted assignment when both cleanup attempts fail, without logging credentials", async () => {
    pool.rememberCodexPoolAssignment(assignment, "token");
    mocks.apiFetch.mockRejectedValue(new Error(`private body ${assignment.capability}`));
    await post.runOAuthWriteback();
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.state).codexPool.assignment).toEqual(assignment);
    expect(JSON.stringify(mocks.warning.mock.calls)).not.toContain(assignment.capability);
  });
});
