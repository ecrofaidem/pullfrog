import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isBaseOnlyMerge } from "../convex/lib/baseMerge";

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const sha = (ref = "HEAD") => git("rev-parse", ref);
function commit(file: string, content: string) {
  writeFileSync(join(dir, file), content);
  git("add", "--all");
  git("commit", "-qm", "fixture");
  return sha();
}
let before: string;
let base: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pullfrog-base-merge-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  commit("shared", "original\n");
  git("checkout", "-qb", "feature");
  before = commit("feature", "PR work\n");
  git("checkout", "-q", "main");
  base = commit("base", "base work\n");
  git("checkout", "-q", "feature");
  // Serve real Git objects through the same HTTP boundary as GitHub. No model or remote writes.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname.split("/repos/owner/repo/")[1];
      if (path.startsWith("git/commits/")) {
        const ref = path.slice("git/commits/".length);
        return Response.json({
          sha: sha(ref),
          tree: { sha: sha(`${ref}^{tree}`) },
          parents: git("show", "-s", "--format=%P", ref)
            .split(" ")
            .filter(Boolean)
            .map((sha) => ({ sha })),
        });
      }
      if (path.startsWith("compare/")) {
        const [a, b] = path.slice("compare/".length).split("...");
        const ancestor = git("merge-base", a, b);
        return Response.json({
          merge_base_commit: { sha: ancestor },
          status: a === b ? "identical" : ancestor === a ? "ahead" : ancestor === b ? "behind" : "diverged",
        });
      }
      if (path.startsWith("git/blobs/")) {
        const content = execFileSync("git", ["cat-file", "blob", path.slice("git/blobs/".length)], {
          cwd: dir,
        });
        return Response.json({
          encoding: "base64",
          size: content.length,
          content: content.toString("base64"),
        });
      }
      if (path.startsWith("git/trees/")) {
        const tree = git("ls-tree", "-rz", path.slice("git/trees/".length))
          .split("\0")
          .filter(Boolean)
          .map((line) => {
            const [meta, path] = line.split("\t");
            const [mode, type, sha] = meta.split(" ");
            return { mode, type, sha, path, size: Number(git("cat-file", "-s", sha!)) };
          });
        return Response.json({ tree, truncated: false });
      }
      throw new Error(`Unexpected path ${path}`);
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
const check = () =>
  isBaseOnlyMerge({
    token: "fixture",
    owner: "owner",
    repo: "repo",
    beforeSha: before,
    headSha: sha(),
    baseSha: base,
  });

it("skips a clean base merge even with an arbitrary commit message", async () => {
  git("merge", "--no-ff", "-m", "arbitrary", "main");
  expect(await check()).toBe(true);
});
it("recognizes an older base tip after the base branch advances", async () => {
  git("merge", "--no-ff", "-m", "merge", "main");
  git("checkout", "-q", "main");
  base = commit("later", "later\n");
  git("checkout", "-q", "feature");
  expect(await check()).toBe(true);
});
it("keeps normal pushes and pushes bundling new PR commits with a merge", async () => {
  commit("new", "new work\n");
  expect(await check()).toBe(false);
  git("merge", "--no-ff", "-m", "merge", "main");
  expect(await check()).toBe(false);
});
it("keeps merges from another feature branch", async () => {
  git("checkout", "-qb", "other", "main");
  commit("other", "other work\n");
  git("checkout", "-q", "feature");
  git("merge", "--no-ff", "-m", "Merge branch 'main'", "other");
  expect(await check()).toBe(false);
});
it("keeps conflict resolutions", async () => {
  before = commit("shared", "PR version\n");
  git("checkout", "-q", "main");
  base = commit("shared", "base version\n");
  git("checkout", "-q", "feature");
  expect(() => git("merge", "--no-ff", "-m", "merge", "main")).toThrow();
  commit("shared", "resolved\n");
  expect(await check()).toBe(false);
});
it.each(["content", "mode", "delete"])(
  "keeps extra %s changes hidden in the merge commit",
  async (change) => {
    git("merge", "--no-ff", "--no-commit", "main");
    if (change === "mode") chmodSync(join(dir, "feature"), 0o755);
    if (change === "content") writeFileSync(join(dir, "feature"), "changed\n");
    if (change === "delete") rmSync(join(dir, "feature"));
    git("add", "--all");
    git("commit", "-qm", "merge");
    expect(await check()).toBe(false);
  }
);
it("handles base deletions and renames", async () => {
  git("checkout", "-q", "main");
  git("mv", "shared", "renamed");
  git("rm", "base");
  git("commit", "-qm", "rename and delete");
  base = sha();
  git("checkout", "-q", "feature");
  git("merge", "--no-ff", "-m", "merge", "main");
  expect(await check()).toBe(true);
});
it("keeps review when tree data is truncated or GitHub is unavailable", async () => {
  git("merge", "--no-ff", "-m", "merge", "main");
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    String(args[0]).includes("git/trees/") ? Response.json({ tree: [], truncated: true }) : original(...args)
  );
  expect(await check()).toBe(false);
  vi.mocked(fetch).mockRejectedValue(new Error("unavailable"));
  expect(await check()).toBe(false);
});
it("keeps events without valid immutable SHAs without calling GitHub", async () => {
  base = "";
  expect(await check()).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([false, true])(
  "verifies clean text merges including UTF-8 and CRLF (extra edit: %s)",
  async (extra) => {
    const original = "one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n";
    git("checkout", "-q", "main");
    commit("text", original);
    git("checkout", "-q", "feature");
    git("merge", "--no-ff", "-m", "setup", "main");
    before = commit("text", original.replace("one", "ä ours"));
    git("checkout", "-q", "main");
    base = commit("text", original.replace("five", "ü theirs"));
    git("checkout", "-q", "feature");
    git("merge", "--no-ff", "--no-commit", "main");
    if (extra)
      writeFileSync(
        join(dir, "text"),
        original.replace("one", "ä ours").replace("five", "ü theirs").replace("three", "extra")
      );
    git("add", "--all");
    git("commit", "-qm", "merge");
    expect(await check()).toBe(!extra);
  }
);

it.each([".gitattributes", "nested/.gitattributes"])(
  "keeps manually combined text when %s makes Git report a conflict",
  async (attributes) => {
    const file = "nested/text";
    const original = "one\ntwo\nthree\nfour\nfive\n";
    git("checkout", "-q", "main");
    mkdirSync(join(dir, "nested"));
    commit(file, original);
    commit(attributes, "* text -merge\n");
    git("checkout", "-q", "feature");
    git("merge", "--no-ff", "-m", "setup", "main");
    before = commit(file, original.replace("one", "ours"));
    git("checkout", "-q", "main");
    base = commit(file, original.replace("five", "theirs"));
    git("checkout", "-q", "feature");
    expect(() => git("merge", "--no-ff", "-m", "merge", "main")).toThrow();
    expect(git("diff", "--name-only", "--diff-filter=U")).toBe(file);
    commit(file, original.replace("one", "ours").replace("five", "theirs"));
    expect(await check()).toBe(false);
  }
);

it.each(["feature", "main"])(
  "keeps review when attributes are introduced only on %s",
  async (branch) => {
    const original = "one\ntwo\nthree\nfour\nfive\n";
    git("checkout", "-q", "main");
    commit("text", original);
    git("checkout", "-q", "feature");
    git("merge", "--no-ff", "-m", "setup", "main");
    if (branch === "feature") commit(".gitattributes", "* text\n");
    before = commit("text", original.replace("one", "ours"));
    git("checkout", "-q", "main");
    if (branch === "main") commit(".gitattributes", "* text\n");
    base = commit("text", original.replace("five", "theirs"));
    git("checkout", "-q", "feature");
    git("merge", "--no-ff", "-m", "merge", "main");
    expect(await check()).toBe(false);
  }
);

it("still verifies text merges when attributes exist only in an unrelated directory", async () => {
  const original = "one\ntwo\nthree\nfour\nfive\n";
  git("checkout", "-q", "main");
  mkdirSync(join(dir, "unrelated"));
  commit("unrelated/.gitattributes", "* text -merge\n");
  commit("text", original);
  git("checkout", "-q", "feature");
  git("merge", "--no-ff", "-m", "setup", "main");
  before = commit("text", original.replace("one", "ours"));
  git("checkout", "-q", "main");
  base = commit("text", original.replace("five", "theirs"));
  git("checkout", "-q", "feature");
  git("merge", "--no-ff", "-m", "merge", "main");
  expect(await check()).toBe(true);
});
