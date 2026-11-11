import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initToolState, primaryRepoState } from "../toolState.ts";
import { CheckoutPrTool, type FormatFilesResult, formatFilesWithLineNumbers, writeUnifiedPrDiff } from "./checkout.ts";
import type { ToolContext } from "./server.ts";

/**
 * parses TOC entries like "- src/math.ts → lines 7-42 · diff-<hex>" into structured data.
 */
function parseTocEntries(toc: string) {
  const entries: Array<{ filename: string; startLine: number; endLine: number }> = [];
  for (const line of toc.split("\n")) {
    const match = line.match(/^- (.+) → lines (\d+)-(\d+) · diff-[0-9a-f]+$/);
    if (match) {
      entries.push({
        filename: match[1],
        startLine: parseInt(match[2], 10),
        endLine: parseInt(match[3], 10),
      });
    }
  }
  return entries;
}

// fixture captured by action/scripts/refresh-test-fixtures.ts. running
// the formatter against checked-in JSON keeps this test offline and
// deterministic — re-fetch the fixture (with creds) when GitHub's
// pulls.listFiles response shape changes, then review the snapshot diff.
type DiffFixture = {
  owner: string;
  name: string;
  pullNumber: number;
  files: Parameters<typeof formatFilesWithLineNumbers>[0];
};

function loadFixture<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "__fixtures__", file), "utf-8")) as T;
}

describe("formatFilesWithLineNumbers", () => {
  it("generates accurate TOC line numbers for pullfrog/test-repo#1", () => {
    const fx = loadFixture<DiffFixture>("pullfrog-test-repo-pr-1.diff.json");
    const result: FormatFilesResult = formatFilesWithLineNumbers(fx.files);

    expect(result.content.startsWith(result.toc)).toBe(true);

    const contentLines = result.content.split("\n");
    const tocEntries = parseTocEntries(result.toc);
    expect(tocEntries.length).toBeGreaterThan(0);

    for (const entry of tocEntries) {
      // line numbers are 1-indexed, arrays are 0-indexed
      const firstLine = contentLines[entry.startLine - 1];
      expect(firstLine).toBeDefined();
      // first line of each file section should be the diff header
      expect(firstLine).toBe(`diff --git a/${entry.filename} b/${entry.filename}`);

      expect(entry.endLine).toBeLessThanOrEqual(contentLines.length);
    }

    // verify adjacent files don't overlap and are contiguous
    for (let i = 1; i < tocEntries.length; i++) {
      const prev = tocEntries[i - 1];
      const curr = tocEntries[i];
      expect(curr.startLine).toBe(prev.endLine + 1);
    }

    expect(result.toc).toMatchSnapshot("toc");
    expect(result.content).toMatchSnapshot("content");
  });
});

describe("writeUnifiedPrDiff", () => {
  it("exports a parseable committed PR diff including large files and renames", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pullfrog-unified-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
    try {
      git("init", "-q");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.test");
      writeFileSync(join(cwd, "old name.txt"), "preserved content\n");
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD").trim();
      git("checkout", "-qb", "feature");
      renameSync(join(cwd, "old name.txt"), join(cwd, "new name.txt"));
      const large = Array.from({ length: 20000 }, (_, i) => `SELECT ${i};`).join("\n") + "\n";
      writeFileSync(join(cwd, "large.sql"), large);
      writeFileSync(join(cwd, "trailing.txt"), "trailing spaces  ");
      git("add", ".");
      git("commit", "-qm", "changes");
      const headSha = git("rev-parse", "HEAD").trim();
      git("checkout", "-q", "--detach", base);
      writeFileSync(join(cwd, "base-only.txt"), "not in PR\n");
      git("add", ".");
      git("commit", "-qm", "base advanced");
      const baseSha = git("rev-parse", "HEAD").trim();
      git("checkout", "-q", "feature");
      writeFileSync(join(cwd, "large.sql"), "dirty edit must not leak\n");
      const diffPath = join(cwd, "review.diff");
      writeUnifiedPrDiff({ cwd, baseSha, headSha, diffPath });
      const diff = readFileSync(diffPath, "utf8");
      const stat = git("apply", "--numstat", diffPath);
      expect(stat).toContain("20000\t0\tlarge.sql");
      expect(stat).toContain("new name.txt");
      expect(diff).toContain("rename from old name.txt");
      expect(diff).toContain("+SELECT 19999;");
      expect(diff).toContain("+trailing spaces  \n\\ No newline at end of file\n");
      expect(diff).not.toContain("dirty edit");
      expect(diff).not.toContain("base-only.txt");
      git("checkout", "-q", "--detach", base, "--force");
      git("apply", "--check", diffPath);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the artifact's identity when the same revision is exported again", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pullfrog-unified-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
    try {
      git("init", "-q");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.test");
      writeFileSync(join(cwd, "a.txt"), "one\n");
      git("add", ".");
      git("commit", "-qm", "base");
      const baseSha = git("rev-parse", "HEAD").trim();
      writeFileSync(join(cwd, "a.txt"), "two\n");
      git("commit", "-qam", "change");
      const headSha = git("rev-parse", "HEAD").trim();
      const diffPath = join(cwd, "review.diff");
      writeUnifiedPrDiff({ cwd, baseSha, headSha, diffPath });
      const before = statSync(diffPath, { bigint: true });
      writeUnifiedPrDiff({ cwd, baseSha, headSha, diffPath });
      const after = statSync(diffPath, { bigint: true });
      expect([after.ino, after.mtimeNs, after.ctimeNs]).toEqual([before.ino, before.mtimeNs, before.ctimeNs]);
      writeFileSync(join(cwd, "a.txt"), "three\n");
      git("commit", "-qam", "another change");
      writeUnifiedPrDiff({ cwd, baseSha, headSha: git("rev-parse", "HEAD").trim(), diffPath });
      expect(readFileSync(diffPath, "utf8")).toContain("+three");
      expect(readdirSync(cwd).filter(name => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not present the numbered display as a unified patch", () => {
    const fx = loadFixture<DiffFixture>("pullfrog-test-repo-pr-1.diff.json");
    const formatted = formatFilesWithLineNumbers(fx.files).content;
    expect(() => execFileSync("git", ["apply", "--numstat"], {
      input: formatted, stdio: ["pipe", "pipe", "pipe"],
    })).toThrow();
  });
});

describe("CheckoutPrTool during a Codex review", () => {
  it("refuses another PR without touching GitHub or the working tree", async () => {
    const toolState = initToolState({ owner: "o", name: "r", dir: tmpdir(), progressComment: undefined });
    toolState.selectedMode = "Review";
    toolState.agent = "codex";
    const repo = primaryRepoState(toolState);
    repo.reviewCoverage = { scope: { pullNumber: 7 } } as unknown as NonNullable<typeof repo.reviewCoverage>;
    const get = vi.fn();
    const ctx = { agentId: "codex", toolState, repo: { owner: "o", name: "r" }, octokit: { rest: { pulls: { get } } }, payload: {} } as unknown as ToolContext;
    const result = await CheckoutPrTool(ctx).execute({ pull_number: 8 }, {} as never);
    expect(result).toHaveProperty("isError", true);
    expect(JSON.stringify(result)).toContain("reviewing PR #7");
    expect(get).not.toHaveBeenCalled();
  });
});
