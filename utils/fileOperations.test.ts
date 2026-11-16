import { describe, expect, it } from "vitest";
import type { AgentId } from "../external.ts";
import type { ResolvedPayload } from "./payload.ts";
import { codexSandboxMode, fileWriteInstructions } from "./fileOperations.ts";

const payload = (shell: ResolvedPayload["shell"], push: ResolvedPayload["push"] = "enabled", trigger = "pull_request") => ({ shell, push, event: { trigger } }) as ResolvedPayload;

describe("file write instructions", () => {
  it.each(["restricted", "enabled"] as const)("uses MCP shell for Codex Linux writes with shell=%s", shell => {
    const instructions = fileWriteInstructions("codex", payload(shell), "linux");
    expect(instructions).toContain("shell");
    expect(instructions).toContain("apply_patch cannot write");
    expect(instructions).not.toContain("Use your native file");
    expect(instructions).not.toContain("Do not modify the checkout");
  });
  it("limits read-only runs to scratch writes but allows docs preparation", () => {
    expect(fileWriteInstructions("codex", payload("restricted", "disabled"), "linux")).toContain("Do not modify the checkout");
    const docs = payload("restricted", "disabled", "pull_request_merged");
    expect(codexSandboxMode(docs)).toBe("workspace-write");
    expect(fileWriteInstructions("codex", docs, "linux")).not.toContain("Do not modify the checkout");
  });
  it("reports unavailable writes when Codex Linux shell is disabled", () => {
    expect(fileWriteInstructions("codex", payload("disabled"), "linux")).toContain("cannot change files");
  });
  it.each([["opencode", "linux"], ["codex", "darwin"]] as const)("keeps native writes for %s on %s", (agent: AgentId, platform) => {
    expect(fileWriteInstructions(agent, payload("restricted"), platform)).toContain("native file");
  });
});
