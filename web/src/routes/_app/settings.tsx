// Settings: the repo's config as a keyed sheet. The keys are the contract the
// CLI endpoint speaks (server/convex/configKeys.ts), so what you read here you
// can `PATCH /api/cli/config` with. Rare, consequential changes: the current
// value is unmistakable and saving is one deliberate action.

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@server/_generated/api";
import type { Doc } from "@server/_generated/dataModel";
import { type ConfigKey } from "@server/configKeys";
import type { RepoPatch } from "@server/repos";
import { Check } from "~/components/glyphs";
import { SheetSkeleton } from "~/components/skeleton";
import { relative } from "~/lib/format";
import { useNow } from "~/lib/now";
import { fullName, healthQuery, pickRepo, reposQuery, useCurrentRepo } from "~/lib/repo";

export const Route = createFileRoute("/_app/settings")({
  loaderDeps: ({ search }) => ({ repo: search.repo }),
  loader: async ({ context, deps }) => {
    const repos = await context.queryClient.ensureQueryData(reposQuery);
    const repo = pickRepo(repos, deps.repo);
    if (repo) await context.queryClient.ensureQueryData(healthQuery(repo));
  },
  pendingComponent: SheetSkeleton,
  component: SettingsPage,
});

type Tier = Doc<"repos">["push"];

interface Form {
  enabled: boolean;
  model: string;
  effort: string;
  reviewAuthorsMode: Doc<"repos">["reviewAuthorsMode"];
  reviewAuthors: string;
  reviewOnSynchronize: boolean;
  handle: string;
  signature: string;
  timeout: string;
  push: Tier;
  shell: Tier;
  codexAgent: boolean;
  statusChecks: boolean;
  progressComments: boolean;
  setupScript: string;
  postCheckoutScript: string;
}

const EFFORTS: { value: string; label: string }[] = [
  { value: "", label: "model default" },
  { value: "0", label: "low" },
  { value: "0.25", label: "medium" },
  { value: "0.5", label: "high" },
  { value: "0.75", label: "xhigh" },
  { value: "1", label: "max" },
];

const MODELS = ["gpt-sol", "gpt-sol-pro", "claude-opus", "claude-sonnet", "claude-haiku"];

const TIMEOUT_RE = /^(\d+h)?(\d+m)?$/;

function toForm(repo: Doc<"repos">): Form {
  return {
    enabled: repo.enabled,
    model: repo.model ?? "",
    effort: repo.effort === null ? "" : String(repo.effort),
    reviewAuthorsMode: repo.reviewAuthorsMode,
    reviewAuthors: repo.reviewAuthors.join("\n"),
    reviewOnSynchronize: repo.reviewOnSynchronize,
    handle: repo.handle,
    signature: repo.signature,
    timeout: repo.timeout,
    push: repo.push,
    shell: repo.shell,
    codexAgent: repo.codexAgent,
    statusChecks: repo.statusChecks,
    progressComments: repo.progressComments,
    setupScript: repo.setupScript ?? "",
    postCheckoutScript: repo.postCheckoutScript ?? "",
  };
}

/** the normalised patch; comparing two of these is what "dirty" means. */
function toPatch(form: Form): RepoPatch {
  return {
    enabled: form.enabled,
    model: form.model.trim() || null,
    effort: form.effort === "" ? null : Number(form.effort),
    reviewAuthorsMode: form.reviewAuthorsMode,
    reviewAuthors: [
      ...new Set(
        form.reviewAuthors
          .split(/[\s,]+/)
          .map((s) => s.trim().replace(/^@/, "").toLowerCase())
          .filter(Boolean)
      ),
    ],
    reviewOnSynchronize: form.reviewOnSynchronize,
    handle: form.handle.trim().replace(/^@/, ""),
    signature: form.signature,
    timeout: form.timeout.trim(),
    push: form.push,
    shell: form.shell,
    codexAgent: form.codexAgent,
    statusChecks: form.statusChecks,
    progressComments: form.progressComments,
    setupScript: form.setupScript.trim() ? form.setupScript : null,
    postCheckoutScript: form.postCheckoutScript.trim() ? form.postCheckoutScript : null,
  };
}

/** the server's rules (convex/repos.ts validatePatch), checked before the round trip. */
function validate(form: Form): Partial<Record<ConfigKey, string>> {
  const errors: Partial<Record<ConfigKey, string>> = {};
  const t = form.timeout.trim();
  if (!t || !TIMEOUT_RE.test(t)) errors["run.timeout"] = "Use a length like 45m, 1h or 1h30m.";
  const h = form.handle.trim().replace(/^@/, "");
  if (!/^[a-z0-9-]+$/i.test(h)) errors["comment.handle"] = "Letters, digits and hyphens only, like a GitHub App slug.";
  if (form.effort !== "") {
    const e = Number(form.effort);
    if (!(e >= 0 && e <= 1)) errors.effort = "Pick a rung.";
  }
  return errors;
}

function SettingsPage() {
  const repo = useCurrentRepo()!;
  const now = useNow();
  const update = useMutation(api.repos.update).withOptimisticUpdate((store, { id, patch }) => {
    const current = store.getQuery(api.repos.list, {});
    if (!current) return;
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    store.setQuery(
      api.repos.list,
      {},
      current.map((r) => (r._id === id ? { ...r, ...defined, updatedAt: Date.now() } : r))
    );
  });

  // seed: the doc the form was built from. live changes to the repo doc
  // reset an untouched form and are surfaced as a conflict on a dirty one.
  const [seed, setSeed] = useState(repo);
  const [form, setForm] = useState<Form>(() => toForm(repo));
  const [errors, setErrors] = useState<Partial<Record<ConfigKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = useMemo(() => JSON.stringify(toPatch(form)) !== JSON.stringify(toPatch(toForm(seed))), [form, seed]);
  const conflicted = useMemo(
    () => dirty && JSON.stringify(toPatch(toForm(repo))) !== JSON.stringify(toPatch(toForm(seed))),
    [dirty, repo, seed]
  );
  useEffect(() => {
    if (!dirty && repo !== seed) {
      setSeed(repo);
      setForm(toForm(repo));
    }
  }, [repo, seed, dirty]);

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm("Discard unsaved settings?"),
    enableBeforeUnload: () => dirty,
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerError(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    const firstKey = Object.keys(found)[0];
    if (firstKey) {
      formRef.current?.querySelector<HTMLElement>(`[data-key="${firstKey}"]`)?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await update({ id: repo._id, patch: toPatch(form) });
      setSeed(repo);
      setSavedAt(Date.now());
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setServerError(raw.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0] ?? raw);
    } finally {
      setSaving(false);
    }
  }

  const allowlistCount = toPatch(form).reviewAuthors!.length;
  const showBar = dirty || saving || !!serverError || (savedAt !== null && now !== null && now - savedAt < 8000);
  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL;

  return (
    <form
      ref={formRef}
      onSubmit={save}
      className="max-w-[60ch]"
      onKeyDown={(e) => {
        // Enter in a text field must not commit fifteen settings on a reflex
        const el = e.target as HTMLElement;
        if (e.key === "Enter" && el.tagName === "INPUT" && (el as HTMLInputElement).type === "text") e.preventDefault();
      }}
    >
      <h1 className="sr-only">Settings for {fullName(repo)}</h1>

      <Group title="Repository" hint="The switch everything below depends on.">
        <Row k="enabled" help="Off: webhooks are ignored and run-context refuses this repo. Every review stops.">
          <EnabledControl value={form.enabled} onChange={(v) => set("enabled", v)} />
        </Row>
      </Group>

      <Group title="Review policy" hint="Who gets reviewed automatically, and when.">
        <Row
          k="review.authors"
          help={
            form.reviewAuthorsMode === "all"
              ? "Every human-authored, non-draft PR is reviewed. Each one spends the subscription's rate budget."
              : `Only PRs by these GitHub logins. ${allowlistCount === 0 ? "Empty list: nobody is reviewed automatically." : `${allowlistCount} allowed.`}`
          }
          control={(ids) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Who gets reviewed</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5 py-1">
                  <input type="radio" name="mode" className="size-4" checked={form.reviewAuthorsMode === "allowlist"} onChange={() => set("reviewAuthorsMode", "allowlist")} />
                  allowlist
                </label>
                <label className="flex items-center gap-1.5 py-1">
                  <input type="radio" name="mode" className="size-4" checked={form.reviewAuthorsMode === "all"} onChange={() => set("reviewAuthorsMode", "all")} />
                  everyone
                </label>
              </div>
              {form.reviewAuthorsMode === "allowlist" && (
                <textarea
                  id={ids.control}
                  aria-describedby={ids.help}
                  data-key="review.authors"
                  className="field mono min-h-[4.5rem] w-full"
                  rows={3}
                  value={form.reviewAuthors}
                  onChange={(e) => set("reviewAuthors", e.target.value)}
                  placeholder="one GitHub login per line"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                />
              )}
            </fieldset>
          )}
        />
        <Row k="review.on_push" help="Review the new commits when a reviewed PR is pushed to (incremental review).">
          <Toggle checked={form.reviewOnSynchronize} onChange={(v) => set("reviewOnSynchronize", v)} label="re-review on push" />
        </Row>
        <Row
          k="comment.handle"
          help={`Anyone with write access can comment @${form.handle || "…"} review on any PR.`}
          error={errors["comment.handle"]}
          control={(ids) => (
            <span className="flex items-center gap-1">
              <span className="text-ink-3">@</span>
              <input
                id={ids.control}
                aria-describedby={ids.help}
                aria-invalid={errors["comment.handle"] ? "true" : undefined}
                data-key="comment.handle"
                className="field mono w-44"
                type="text"
                value={form.handle}
                onChange={(e) => set("handle", e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
              />
            </span>
          )}
        />
        <Row
          k="comment.signature"
          help="Closes every review body on its own line. Leave empty for none."
          control={(ids) => (
            <input id={ids.control} aria-describedby={ids.help} className="field w-32" type="text" value={form.signature} onChange={(e) => set("signature", e.target.value)} />
          )}
        />
      </Group>

      <Group title="Model" hint="What the agent runs on. The Codex chain in Credentials is what pays for it.">
        <Row
          k="model"
          help="A curated slug (gpt-sol) or a raw models.dev id (openai/gpt-5.6-sol). A typo fails at run time, in GitHub."
          control={(ids) => (
            <>
              <input id={ids.control} aria-describedby={ids.help} className="field mono w-full sm:w-72" type="text" list="models" value={form.model} onChange={(e) => set("model", e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" />
              <datalist id="models">
                {MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
        />
        <Row
          k="effort"
          help="Reasoning effort as a rung on the running model's own ladder, rounding down. Higher rungs cost more of the rate budget per review."
          error={errors.effort}
          control={(ids) => (
            <select id={ids.control} aria-describedby={ids.help} data-key="effort" className="field w-44" value={form.effort} onChange={(e) => set("effort", e.target.value)}>
              {EFFORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        />
        <Row k="agent.codex" help="Run the native Codex CLI harness instead of OpenCode. Experimental upstream; no subagents.">
          <Toggle checked={form.codexAgent} onChange={(v) => set("codexAgent", v)} label="native codex harness" />
        </Row>
      </Group>

      <Group title="Run" hint="Limits and permissions handed to the action.">
        <Row
          k="run.timeout"
          help="Maximum run length: 45m, 1h, 1h30m. Runs still open 15 minutes past it are marked failed."
          error={errors["run.timeout"]}
          control={(ids) => (
            <input id={ids.control} aria-describedby={ids.help} aria-invalid={errors["run.timeout"] ? "true" : undefined} data-key="run.timeout" className="field mono w-28" type="text" value={form.timeout} onChange={(e) => set("timeout", e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" />
          )}
        />
        <Row
          k="run.push"
          help="disabled: read-only checkout. restricted: feature branches only. enabled: may push the default branch."
          control={(ids) => <TierSelect id={ids.control} describedBy={ids.help} value={form.push} onChange={(v) => set("push", v)} />}
        />
        <Row
          k="run.shell"
          help="disabled: no shell tool. restricted: secrets filtered out of the shell's environment. enabled: the full environment."
          control={(ids) => <TierSelect id={ids.control} describedBy={ids.help} value={form.shell} onChange={(v) => set("shell", v)} />}
        />
        <Row k="run.checks" help="Post the pullfrog check-run on the PR while a run is in flight.">
          <Toggle checked={form.statusChecks} onChange={(v) => set("statusChecks", v)} label="status check" />
        </Row>
        <Row k="run.progress_comments" help="Live task-list updates in the progress comment.">
          <Toggle checked={form.progressComments} onChange={(v) => set("progressComments", v)} label="progress comments" />
        </Row>
        <Row
          k="run.setup"
          help="Runs once after checkout, before the agent starts. Dependency installs go here."
          control={(ids) => (
            <textarea id={ids.control} aria-describedby={ids.help} className="field mono min-h-[6rem] w-full" rows={5} value={form.setupScript} onChange={(e) => set("setupScript", e.target.value)} placeholder="cd dashboard && pnpm install --frozen-lockfile" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          )}
        />
        <Row
          k="run.post_checkout"
          help="Runs after every branch checkout the agent performs."
          control={(ids) => (
            <textarea id={ids.control} aria-describedby={ids.help} className="field mono min-h-[3.5rem] w-full" rows={2} value={form.postCheckoutScript} onChange={(e) => set("postCheckoutScript", e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          )}
        />
      </Group>

      <p className="mt-8 text-sm text-ink-3">
        {repo.updatedBy ? `Last changed by ${repo.updatedBy} ${relative(repo.updatedAt, now)}.` : "Unchanged since setup."}{" "}
        These keys are the config contract: <code className="text-ink-2">GET</code> or{" "}
        <code className="text-ink-2">PATCH {siteUrl}/api/cli/config?owner={repo.owner}&repo={repo.name}</code> with your GitHub token accepts the same names.
      </p>

      {showBar && (
        <div className="sticky bottom-0 -mx-5 mt-6 flex flex-wrap items-center gap-3 border-t border-hair bg-sheet px-5 py-3 sm:mx-0 sm:px-0">
          {dirty ? (
            <>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setForm(toForm(repo));
                  setSeed(repo);
                  setErrors({});
                  setServerError(null);
                }}
              >
                Discard
              </button>
              {conflicted ? (
                <span className="text-sm text-ink">
                  {repo.updatedBy ?? "Someone"} changed these settings {relative(repo.updatedAt, now)}, while you were editing.{" "}
                  <button type="button" className="underline" onClick={() => { setForm(toForm(repo)); setSeed(repo); }}>
                    Take theirs
                  </button>{" "}
                  or save to overwrite.
                </span>
              ) : (
                <span className="text-sm text-ink-3">
                  {repo.updatedBy ? `Overwrites ${repo.updatedBy}'s change from ${relative(repo.updatedAt, now)}.` : ""}
                </span>
              )}
            </>
          ) : savedAt !== null ? (
            <span className="inline-flex items-center gap-1 text-sm text-ink-2">
              <Check /> Saved. The next run uses these settings.
            </span>
          ) : null}
          {serverError && (
            <span role="alert" className="text-sm text-ink">
              Not saved: {serverError}
            </span>
          )}
        </div>
      )}
    </form>
  );
}

function EnabledControl({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  if (value) {
    return confirming ? (
      <span className="inline-flex flex-wrap items-center gap-2 pt-1 text-sm">
        <span className="text-ink">Turn frogbot off for this repo?</span>
        <button type="button" className="btn btn-danger" onClick={() => { onChange(false); setConfirming(false); }}>
          Turn off
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
          Keep on
        </button>
      </span>
    ) : (
      <span className="inline-flex items-center gap-3 pt-1 text-sm">
        <span className="text-ink">On</span>
        <button type="button" className="tab text-ink-2 underline hover:text-ink" onClick={() => setConfirming(true)}>
          turn off
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-3 pt-1 text-sm">
      <span className="font-medium text-ink">Off</span>
      <button type="button" className="btn btn-quiet" onClick={() => onChange(true)}>
        Turn on
      </button>
    </span>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-ink-2">{hint}</p>}
      <div className="mt-4 divide-y divide-hair border-y border-hair">{children}</div>
    </section>
  );
}

interface RowIds {
  control: string;
  help: string;
}

function Row({
  k,
  help,
  error,
  control,
  children,
}: {
  k: ConfigKey;
  help: string;
  error?: string | undefined;
  /** render the control with the ids that bind it to the key and its help */
  control?: (ids: RowIds) => React.ReactNode;
  children?: React.ReactNode;
}) {
  const base = useId();
  const ids: RowIds = { control: `${base}-control`, help: `${base}-help` };
  return (
    <div className="grid gap-x-6 gap-y-1.5 py-3 sm:grid-cols-[11rem_1fr]">
      {control ? (
        <label htmlFor={ids.control} className="mono pt-1.5 text-sm text-ink-2">
          {k}
        </label>
      ) : (
        <span className="mono pt-1.5 text-sm text-ink-2">{k}</span>
      )}
      <div>
        {control ? control(ids) : children}
        {error && (
          <p role="alert" className="mt-1 text-sm text-ink">
            {error}
          </p>
        )}
        <p id={ids.help} className="mt-1 text-sm text-ink-3">
          {help}
        </p>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex min-h-6 items-center gap-2 py-1 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      {label}
    </label>
  );
}

function TierSelect({ id, describedBy, value, onChange }: { id: string; describedBy: string; value: Tier; onChange: (v: Tier) => void }) {
  return (
    <select id={id} aria-describedby={describedBy} className="field w-44" value={value} onChange={(e) => onChange(e.target.value as Tier)}>
      <option value="disabled">disabled</option>
      <option value="restricted">restricted</option>
      <option value="enabled">enabled</option>
    </select>
  );
}
