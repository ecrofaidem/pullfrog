import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatShellResult, runSandboxed } from "./shell.ts";

describe("shell recovery guidance", () => {
  let temporary: string;
  beforeEach(() => {
    temporary = mkdtempSync(join(tmpdir(), "pullfrog-shell-recovery-"));
    vi.stubEnv("PULLFROG_TEMP_DIR", temporary);
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(temporary, { recursive: true, force: true }); });
  it("distinguishes missing tooling from a broken check path", async () => {
    const missingTool = await runSandboxed({ command: "pullfrog_nonexistent_test_tool", cwd: process.cwd(), env: { PATH: process.env.PATH }, timeout: 1000 });
    expect(formatShellResult(missingTool).recovery?.kind).toBe("missing_tool");
    expect(formatShellResult(missingTool).recovery?.next_step).toContain("packageManager");
    const missingPath = await runSandboxed({ command: "grep pattern /tmp/pullfrog-nonexistent-migration-79205.sql", cwd: process.cwd(), env: { PATH: process.env.PATH }, timeout: 1000 });
    expect(formatShellResult(missingPath).recovery?.kind).toBe("missing_path");
    expect(formatShellResult(missingPath).recovery?.next_step).toContain("broken check");
  });
  it("makes successful cut-off output a readable continuation, not a failed retry", () => {
    const output = "first line\n" + "x".repeat(8000) + "\nlast line";
    const formatted = formatShellResult({ output, exitCode: 0, timedOut: false });
    expect(formatted.exit_code).toBe(0);
    expect(formatted.recovery?.kind).toBe("output_pagination");
    expect(formatted.output_path).toBeDefined();
    expect(readFileSync(formatted.output_path!, "utf8")).toBe(output);
    expect(formatted.recovery?.next_step).toContain("read_file");
  });
  it("does not turn grep's no-match exit into a missing-path or setup failure", () => {
    expect(formatShellResult({ output: "", exitCode: 1, timedOut: false }).recovery).toBeUndefined();
  });
  it("identifies unavailable dependencies and an actual timeout separately", () => {
    expect(formatShellResult({ output: "Error: Cannot find module 'vitest'", exitCode: 1, timedOut: false }).recovery?.kind).toBe("missing_dependencies");
    expect(formatShellResult({ output: "", exitCode: 143, timedOut: true }).recovery?.kind).toBe("timeout");
  });
});
