import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiffCoverageState, getDiffCoverageBreakdown } from "../utils/diffCoverage.ts";
import { createFileReader } from "./readFile.ts";
import { createReviewReadState } from "../utils/reviewResume.ts";

describe("paged file reading", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pullfrog-read-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function reader(path: string, content: string) {
    writeFileSync(path, content);
    const coverage = createDiffCoverageState({ diffPath: path, totalLines: content ? content.split("\n").length : 0, toc: "" });
    const read = createFileReader({ roots: () => [dir], deniedPaths: [join(dir, "private")], cwd: dir, coverage: () => [coverage] });
    return { read, coverage };
  }

  it("delivers exact Unicode content over bounded pages, including a huge single line", async () => {
    const content = `first\n${"🙂x".repeat(5000)}\nlast\n`;
    const { read, coverage } = reader(join(dir, "diff"), content);
    let page = await read({ path: "diff", max_chars: 2000 });
    expect(getDiffCoverageBreakdown({ state: coverage }).coveredRanges).toEqual([{ startLine: 1, endLine: 1 }]);
    let result = page.content;
    while (page.next_cursor) {
      page = await read({ path: "diff", cursor: page.next_cursor, max_chars: 2000 });
      expect(page.content.length).toBeLessThanOrEqual(2000);
      result += page.content;
    }
    expect(result).toBe(content);
    expect(page.eof).toBe(true);
    expect(getDiffCoverageBreakdown({ state: coverage }).unreadLines).toBe(0);
  });

  it("starts at a requested line boundary without crediting the skipped prefix", async () => {
    const { read, coverage } = reader(join(dir, "diff"), "first\nsecond\nthird\n");
    const page = await read({ path: "diff", start_line: 3 });
    expect(page.content).toBe("third\n");
    expect(page.start_line).toBe(3);
    expect(coverage.coveredRanges).toEqual([{ startLine: 3, endLine: 4 }]);
    await expect(read({ path: "diff", start_line: 5 })).rejects.toThrow(/beyond/);
  });

  it("preserves byte-order marks, CRLF and literal shell syntax in filenames", async () => {
    const path = join(dir, "quoted'$(touch SHOULD_NOT_EXIST)");
    const content = "\ufefffirst\r\nlast\r\n";
    const { read } = reader(path, content);
    expect((await read({ path })).content).toBe(content);
  });

  it("rejects forged cursors and content changes without crediting unread lines", async () => {
    const path = join(dir, "diff");
    const { read, coverage } = reader(path, "x".repeat(1000));
    await expect(read({ path, cursor: "forged" })).rejects.toThrow(/cursor/i);
    const first = await read({ path, max_chars: 100 });
    writeFileSync(path, "y".repeat(1001));
    await expect(read({ path, cursor: first.next_cursor! })).rejects.toThrow(/changed/i);
    expect(coverage.coveredRanges).toEqual([]);
  });

  it("drops earlier coverage when a changed file is read again from a line boundary", async () => {
    const path = join(dir, "diff");
    const { read, coverage } = reader(path, "first\nsecond\nthird");
    await read({ path, max_chars: 6 });
    expect(coverage.coveredRanges).toEqual([{ startLine: 1, endLine: 1 }]);
    writeFileSync(path, "different\nsecond\nthird");
    await read({ path, start_line: 3 });
    expect(coverage.coveredRanges).toEqual([{ startLine: 3, endLine: 3 }]);
  });

  it("never credits replacement content against an immutable checkout artifact", async () => {
    const path = join(dir, "raw.diff");
    writeFileSync(path, "original\n");
    const coverage = createReviewReadState(path);
    const read = createFileReader({ roots: () => [dir], deniedPaths: [], cwd: dir, coverage: () => [coverage] });
    writeFileSync(path, "forged\n");
    await expect(read({ path })).rejects.toThrow(/artifact.*changed/i);
    writeFileSync(path, "original\n");
    expect(coverage.coveredRanges).toEqual([]);
    expect((await read({ path })).content).toBe("original\n");
    expect(coverage.coveredRanges).toEqual([{ startLine: 1, endLine: 2 }]);
  });

  it("denies escapes, secret paths and git config through symlinks", async () => {
    const { read } = reader(join(dir, "ok"), "hello");
    mkdirSync(join(dir, "private"));
    writeFileSync(join(dir, "private", "secret"), "secret");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "config"), "secret");
    symlinkSync(join(dir, ".git", "config"), join(dir, "alias"));
    symlinkSync("/etc/passwd", join(dir, "outside"));
    linkSync(join(dir, "private", "secret"), join(dir, "hardlink"));
    for (const path of ["../outside", "private/secret", ".git/config", "alias", "outside", "hardlink", "/proc/self/environ"]) {
      await expect(read({ path })).rejects.toThrow();
    }
  });

  it("fails closed on platforms without descriptor validation", async () => {
    const { read } = reader(join(dir, "file"), "content");
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    try {
      await expect(read({ path: "file" })).rejects.toThrow("requires Linux descriptor validation");
    } finally { vi.unstubAllGlobals(); }
  });

  it("handles empty files and rejects directories and invalid limits", async () => {
    const { read, coverage } = reader(join(dir, "empty"), "");
    expect(await read({ path: "empty" })).toMatchObject({ content: "", eof: true, next_cursor: null });
    expect(coverage.coveredRanges).toEqual([]);
    await expect(read({ path: dir })).rejects.toThrow(/regular file/i);
    await expect(read({ path: "empty", max_chars: -1 })).rejects.toThrow(/max_chars/);
  });
});
