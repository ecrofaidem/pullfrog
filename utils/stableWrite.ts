import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Write a review artifact only when its bytes change. `read_file` identifies a
 * file by inode, size and timestamps and drops its coverage when that identity
 * changes, so rewriting identical bytes on a repeat `checkout_pr` would erase
 * every page already read. Returns whether the file was (re)written.
 */
export function writeFileIfChanged(path: string, content: string | Buffer): boolean {
  if (existsSync(path) && readFileSync(path).equals(Buffer.from(content))) return false;
  writeFileSync(path, content);
  return true;
}

/** Move a freshly produced file over `path` unless `path` already holds the same bytes. */
export function replaceFileIfChanged(path: string, produced: string): boolean {
  if (existsSync(path) && readFileSync(path).equals(readFileSync(produced))) {
    unlinkSync(produced);
    return false;
  }
  renameSync(produced, path);
  return true;
}
