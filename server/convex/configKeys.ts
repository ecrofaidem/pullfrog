// The settings contract. One dotted key per repo setting, and it is the same
// key everywhere: the dashboard's label column, the `/api/cli/config`
// endpoint, and the docs. Change a key here and every surface follows.

import type { Doc } from "./_generated/dataModel";

export const CONFIG_KEYS = {
  enabled: { field: "enabled", type: "boolean" },
  "review.authors": { field: "reviewAuthors", type: "string[]" },
  "review.authors_mode": { field: "reviewAuthorsMode", type: "'allowlist' | 'all'" },
  "review.on_push": { field: "reviewOnSynchronize", type: "boolean" },
  "comment.handle": { field: "handle", type: "string" },
  "comment.signature": { field: "signature", type: "string" },
  model: { field: "model", type: "string | null" },
  effort: { field: "effort", type: "number | null" },
  "agent.codex": { field: "codexAgent", type: "boolean" },
  "run.timeout": { field: "timeout", type: "string" },
  "run.push": { field: "push", type: "'disabled' | 'restricted' | 'enabled'" },
  "run.shell": { field: "shell", type: "'disabled' | 'restricted' | 'enabled'" },
  "run.checks": { field: "statusChecks", type: "boolean" },
  "run.progress_comments": { field: "progressComments", type: "boolean" },
  "run.setup": { field: "setupScript", type: "string | null" },
  "run.post_checkout": { field: "postCheckoutScript", type: "string | null" },
} as const;

export type ConfigKey = keyof typeof CONFIG_KEYS;
export type RepoField = (typeof CONFIG_KEYS)[ConfigKey]["field"];

export const CONFIG_KEY_LIST = Object.keys(CONFIG_KEYS) as ConfigKey[];

/** the repo doc as the CLI sees it. */
export function toConfig(repo: Doc<"repos">): Record<ConfigKey, unknown> {
  const out = {} as Record<ConfigKey, unknown>;
  for (const key of CONFIG_KEY_LIST) out[key] = repo[CONFIG_KEYS[key].field];
  return out;
}

/** translate a CLI patch keyed by config key into repo fields; unknown keys are reported, not dropped silently. */
export function fromConfig(input: Record<string, unknown>): {
  patch: Partial<Record<RepoField, unknown>>;
  unknown: string[];
} {
  const patch: Partial<Record<RepoField, unknown>> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const entry = CONFIG_KEYS[key as ConfigKey];
    if (!entry) unknown.push(key);
    else patch[entry.field] = value;
  }
  return { patch, unknown };
}
