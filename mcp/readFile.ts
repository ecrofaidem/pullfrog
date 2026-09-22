import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { type } from "arktype";
import { type DiffCoverageState, recordDeliveredDiffRange } from "../utils/diffCoverage.ts";
import { resolveEnv } from "../utils/secrets.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";
import { runSandboxed } from "./shell.ts";

const ReadFileParams = type({
  path: type.string.describe("File path within a checkout or this run's temporary directory."),
  "start_line?": type.number.describe(
    "Optional 1-based starting line for a new read. Do not combine with cursor."
  ),
  "cursor?": type.string.describe(
    "Opaque next_cursor from the previous page of this file. Omit to start at the beginning."
  ),
  "max_chars?": type.number.describe(
    "Maximum page size, 4-12000; default 4000. May return fewer characters to preserve UTF-8."
  ),
});

type ReadParams = typeof ReadFileParams.infer;
type Position = { path: string; offset: number; line: number; identity: string };

// Runs INSIDE the shell sandbox, never in the credential-bearing MCP process.
// Validate both lexical and real paths; the opened descriptor is checked again
// to close symlink swaps between realpath and open. No arbitrary agent code is
// interpolated into this script.
const readPageScript = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const p = JSON.parse(process.argv[1]);
if (process.platform !== 'linux') throw new Error('read_file requires Linux descriptor validation; this platform is unsupported');
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
const roots = p.roots.flatMap(root => [path.resolve(root), fs.realpathSync(root)]);
const denied = p.deniedPaths.flatMap(file => {
  try { return [path.resolve(file), fs.realpathSync(file)]; }
  catch { return [path.resolve(file)]; }
});
const allowed = file => {
  if (!roots.some(root => inside(file, root)) || denied.some(root => inside(file, root)) || /(?:^|\/)\.git\/config(?:$|\/)/.test(file)) {
    throw new Error('File access denied');
  }
};
const requested = path.resolve(p.cwd, p.path);
allowed(requested);
const canonical = fs.realpathSync(requested);
allowed(canonical);
const fd = fs.openSync(canonical, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
try {
  // Check the descriptor actually opened, not a path that can be swapped.
  allowed(fs.realpathSync('/proc/self/fd/' + fd));
  const stat = fs.fstatSync(fd, { bigint: true });
  if (!stat.isFile()) throw new Error('Only regular files can be read');
  if (stat.nlink > 1n) throw new Error('Hard-linked files cannot be read');
  const identity = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  if (p.identity && p.identity !== identity) throw new Error('File changed; restart reading without a cursor');
  if (p.expectedHash && (p.validatedIdentity !== identity || p.validatedHash !== p.expectedHash)) {
    const digest = require('node:crypto').createHash('sha256');
    const chunk = Buffer.alloc(65536);
    let offset = 0;
    for (;;) {
      const size = fs.readSync(fd, chunk, 0, chunk.length, offset);
      if (!size) break;
      digest.update(chunk.subarray(0, size));
      offset += size;
    }
    if (digest.digest('hex') !== p.expectedHash) throw new Error('Review artifact has changed; repeat checkout_pr');
  }
  if (p.startLine > 1) {
    const scan = Buffer.alloc(65536);
    let line = 1;
    while (line < p.startLine) {
      const size = fs.readSync(fd, scan, 0, scan.length, p.offset);
      if (size === 0) throw new Error('start_line is beyond the end of the file');
      let i = 0;
      for (; i < size && line < p.startLine; i++) if (scan[i] === 10) line++;
      p.offset += i;
    }
  }
  const buffer = Buffer.alloc(p.limit + 4);
  const length = fs.readSync(fd, buffer, 0, buffer.length, p.offset);
  let end = Math.min(length, p.limit);
  if (end < length) while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, end));
  const after = fs.fstatSync(fd, { bigint: true });
  if ([after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(':') !== identity) throw new Error('File changed during read; restart without a cursor');
  process.stdout.write(JSON.stringify({ content, canonical, identity, offset: p.offset + end, eof: BigInt(p.offset + end) >= stat.size }));
} finally { fs.closeSync(fd); }
`;

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export function createFileReader(options: {
  roots: () => string[];
  deniedPaths: string[];
  cwd: string;
  coverage: () => DiffCoverageState[];
}) {
  // Opaque server-issued cursors prove the prefix of a split line was delivered.
  // Accepting an arbitrary offset would incorrectly credit an unread prefix.
  const cursors = new Map<string, Position>();
  const identities = new Map<string, string>();
  const validatedHashes = new Map<string, string>();
  const forgetFile = (path: string) => {
    for (const [cursor, position] of cursors) if (position.path === path) cursors.delete(cursor);
    identities.delete(path);
    validatedHashes.delete(path);
    for (const state of options.coverage()) {
      if (resolve(state.diffPath) === path) state.coveredRanges = [];
    }
  };
  return async (params: ReadParams) => {
    if (process.platform !== "linux") throw new Error("read_file requires Linux descriptor validation; this platform is unsupported");
    const limit = params.max_chars ?? 4000;
    if (!Number.isInteger(limit) || limit < 4 || limit > 12000) {
      throw new Error("max_chars must be an integer between 4 and 12000");
    }
    if (
      params.start_line !== undefined &&
      (!Number.isInteger(params.start_line) || params.start_line < 1 || params.cursor)
    ) {
      throw new Error("start_line must be a positive integer and cannot be combined with cursor");
    }
    const path = resolve(options.cwd, params.path);
    const previous = params.cursor ? cursors.get(params.cursor) : undefined;
    if (params.cursor && (!previous || previous.path !== path)) {
      throw new Error("Invalid cursor for this file; restart without a cursor");
    }
    const expectedHash = options.coverage().find(state => resolve(state.diffPath) === path && state.contentHash)?.contentHash;
    const result = await runSandboxed({
      command: `${quote(process.execPath)} -e ${quote(readPageScript)} ${quote(JSON.stringify({
        roots: options.roots(),
        cwd: options.cwd,
        path,
        limit,
        offset: previous?.offset ?? 0,
        startLine: params.start_line ?? 1,
        identity: previous?.identity,
        expectedHash,
        validatedIdentity: identities.get(path),
        validatedHash: validatedHashes.get(path),
        deniedPaths: [
          "/proc",
          "/sys",
          "/var/lib/pullfrog",
          ...(process.env.RUNNER_TEMP
            ? [resolve(process.env.RUNNER_TEMP, "_runner_file_commands")]
            : []),
          ...options.deniedPaths,
        ],
      }))}`,
      env: resolveEnv("restricted"),
      cwd: options.cwd,
      timeout: 30000,
    });
    if (result.exitCode !== 0) {
      if (/File changed|Review artifact has changed/.test(result.output)) {
        forgetFile(path);
      }
      throw new Error(result.output || "File read failed");
    }
    const page: {
      content: string;
      identity: string;
      offset: number;
      eof: boolean;
    } = JSON.parse(result.output);
    const oldIdentity = identities.get(path);
    if (oldIdentity && oldIdentity !== page.identity) {
      forgetFile(path);
    }
    identities.set(path, page.identity);
    if (expectedHash) validatedHashes.set(path, expectedHash);
    const startLine = previous?.line ?? params.start_line ?? 1;
    const newlines = page.content.split("\n").length - 1;
    const nextLine = startLine + newlines;
    // At EOF the last line (including an empty trailing line) is complete.
    // Otherwise only newline-terminated lines are eligible for coverage.
    const completeEnd = page.eof && page.offset > 0 ? nextLine : nextLine - 1;
    for (const state of options.coverage()) {
      recordDeliveredDiffRange({ state, path, startLine, endLine: completeEnd });
    }
    if (params.cursor) cursors.delete(params.cursor);
    // Bound abandoned reads too; expired cursors safely require a fresh read.
    if (cursors.size >= 2048) cursors.delete(cursors.keys().next().value!);
    const nextCursor = page.eof ? null : randomUUID();
    if (nextCursor) {
      cursors.set(nextCursor, { path, offset: page.offset, line: nextLine, identity: page.identity });
    }
    return {
      content: page.content,
      start_line: startLine,
      end_line: nextLine,
      complete_through_line: completeEnd,
      next_cursor: nextCursor,
      eof: page.eof,
    };
  };
}

export function ReadFileTool(ctx: ToolContext) {
  const reader = createFileReader({
    roots: () => [...ctx.toolState.repos.values()].map((repo) => repo.dir).concat(ctx.tmpdir),
    deniedPaths: ctx.secretDenyPaths ?? [],
    cwd: process.cwd(),
    coverage: () =>
      [...ctx.toolState.repos.values()].flatMap((repo) => [
        ...(repo.diffCoverage ? [repo.diffCoverage] : []),
        ...(repo.reviewCoverage?.readCoverage ?? []),
      ]),
  });
  return tool({
    name: "read_file",
    timeoutMs: 35_000,
    description:
      "Read complete, bounded text pages without shell output truncation. Start with path (optionally start_line for a known unread section), then keep the same path and pass next_cursor until eof is true. Content preserves whitespace and UTF-8; a long line can span pages. complete_through_line is the last fully delivered line; end_line may contain only a prefix. Coverage counts a line only after all its fragments have been delivered. If a file changes, restart without a cursor.",
    parameters: ReadFileParams,
    execute: execute(reader),
  });
}
