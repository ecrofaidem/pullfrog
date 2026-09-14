import { diff3Merge } from "node-diff3";
import { gh } from "./github";

type Commit = { sha: string; tree: { sha: string }; parents: { sha: string }[] };
type Entry = { path: string; mode: string; type: string; sha: string; size?: number };
type Tree = { truncated: boolean; tree: Entry[] };
type Comparison = { merge_base_commit: { sha: string } };

const MAX_BLOB_BYTES = 256 * 1024;
const MAX_MERGE_LINES = 2_000;
const MAX_MERGE_FILES = 8;

function same(a: Entry | undefined, b: Entry | undefined): boolean {
  return a?.sha === b?.sha && a?.mode === b?.mode && a?.type === b?.type;
}

/** Prove a single clean base merge. Missing evidence or extra changes keep review enabled. */
export async function isBaseOnlyMerge(params: {
  token: string;
  owner: string;
  repo: string;
  beforeSha: string;
  headSha: string;
  baseSha: string;
}): Promise<boolean> {
  const { beforeSha, headSha, baseSha } = params;
  if (![beforeSha, headSha, baseSha].every((sha) => /^[a-f0-9]{40}$/.test(sha))) return false;
  const root = `/repos/${params.owner}/${params.repo}`;
  const options = { token: params.token };
  try {
    const head = await gh<Commit>(`${root}/git/commits/${headSha}`, options);
    // A push that includes feature work before the merge must still be reviewed.
    if (head.sha !== headSha || head.parents.length !== 2 || head.parents[0]?.sha !== beforeSha) return false;
    const mergedSha = head.parents[1]!.sha;
    if (mergedSha !== baseSha) {
      const ancestry = await gh<Comparison>(`${root}/compare/${mergedSha}...${baseSha}?per_page=1`, options);
      if (ancestry.merge_base_commit.sha !== mergedSha) return false;
    }
    const comparison = await gh<Comparison>(
      `${root}/compare/${beforeSha}...${mergedSha}?per_page=1`,
      options
    );
    const refs = [comparison.merge_base_commit.sha, beforeSha, mergedSha, head.tree.sha];
    const maps = await Promise.all(
      refs.map(async (ref) => {
        const tree = await gh<Tree>(`${root}/git/trees/${ref}?recursive=1`, options);
        if (tree.truncated !== false) throw new Error("Incomplete Git tree");
        return new Map(
          tree.tree.filter((entry) => entry.type !== "tree").map((entry) => [entry.path, entry])
        );
      })
    );
    const [ancestor, before, base, actual] = maps;
    if (!ancestor || !before || !base || !actual) return false;
    const overlaps: Entry[][] = [];
    const paths = new Set(maps.flatMap((map) => [...map.keys()]));
    for (const path of paths) {
      const old = ancestor.get(path),
        ours = before.get(path),
        theirs = base.get(path),
        result = actual.get(path);
      if (!same(ours, old) && !same(theirs, old)) {
        // Attributes can change Git's merge behavior. Without interpreting them,
        // a plain text merge cannot prove that Git would have merged cleanly.
        const directories = path.split("/").slice(0, -1);
        for (let depth = 0; depth <= directories.length; depth++) {
          const attributes = [...directories.slice(0, depth), ".gitattributes"].join("/");
          if (maps.some((map) => map.has(attributes))) return false;
        }
        // Bound the text merge work; unusual modes, add/delete conflicts and large
        // merge batches retain normal review instead of guessing Git's result.
        if (!old || !ours || !theirs || !result || overlaps.length >= MAX_MERGE_FILES) return false;
        const entries = [old, ours, theirs, result];
        if (
          !entries.every(
            (entry) =>
              entry.type === "blob" &&
              typeof entry.size === "number" &&
              entry.size <= MAX_BLOB_BYTES &&
              entry.mode === old.mode &&
              /^100(644|755)$/.test(entry.mode)
          )
        )
          return false;
        overlaps.push(entries);
      } else if (!same(result, same(ours, old) ? theirs : ours)) {
        return false;
      }
    }
    for (const entries of overlaps) {
      const lines = await Promise.all(
        entries.map(async (entry) => {
          const blob = await gh<{ encoding: string; size: number; content: string }>(
            `${root}/git/blobs/${entry.sha}`,
            options
          );
          if (blob.encoding !== "base64" || blob.size > MAX_BLOB_BYTES) return null;
          // Binary strings preserve bytes, including UTF-8 and line endings, exactly.
          const bytes = atob(blob.content.replace(/\s/g, ""));
          if (bytes.includes("\0") || bytes.length > MAX_BLOB_BYTES) return null;
          const lines = bytes.split("\n");
          return lines.length <= MAX_MERGE_LINES ? lines : null;
        })
      );
      const [old, ours, theirs, result] = lines;
      if (!old || !ours || !theirs || !result) return false;
      const merged = diff3Merge(ours, old, theirs);
      if (merged.some((block) => block.conflict)) return false;
      if (merged.flatMap((block) => block.ok ?? []).join("\n") !== result.join("\n")) return false;
    }
    return true;
  } catch (error) {
    console.warn("Could not verify base-only merge; retaining review", error);
    return false;
  }
}
