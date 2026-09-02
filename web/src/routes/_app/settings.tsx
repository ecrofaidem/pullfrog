// Settings: the repo's config as a keyed sheet. Rare, consequential changes,
// so the current value is unmistakable and saving is one deliberate action.

import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@server/_generated/api";
import type { Doc } from "@server/_generated/dataModel";
import { Check } from "~/components/glyphs";
import { ago } from "~/lib/format";
import { useCurrentRepo } from "~/lib/repo";

export const Route = createFileRoute("/_app/settings")({
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

function toPatch(form: Form) {
  return {
    enabled: form.enabled,
    model: form.model.trim() || null,
    effort: form.effort === "" ? null : Number(form.effort),
    reviewAuthorsMode: form.reviewAuthorsMode,
    reviewAuthors: form.reviewAuthors
      .split(/[\s,]+/)
      .map((s) => s.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean),
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

function SettingsPage() {
  const repo = useCurrentRepo()!;
  const update = useMutation(api.repos.update);
  const [form, setForm] = useState<Form>(() => toForm(repo));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // a change from elsewhere (another tab, the CLI) resets an untouched form
  const baseline = useMemo(() => JSON.stringify(toForm(repo)), [repo]);
  const dirty = JSON.stringify(form) !== baseline;
  useEffect(() => {
    if (!dirty) setForm(toForm(repo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await update({ id: repo._id, patch: toPatch(form) });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*Uncaught Error: /, "") : String(err));
    } finally {
      setSaving(false);
    }
  }

  const allowlistCount = toPatch(form).reviewAuthors.length;

  return (
    <form onSubmit={save} className="max-w-[60ch]">
      <Group title="Review policy" hint="Who gets reviewed automatically, and when.">
        <Row k="review.authors" help={
          form.reviewAuthorsMode === "all"
            ? "Every human-authored, non-draft PR is reviewed."
            : `Only PRs by these GitHub logins. ${allowlistCount === 0 ? "Empty list: nobody is reviewed automatically." : `${allowlistCount} allowed.`}`
        }>
          <div className="flex flex-col gap-2">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="mode" checked={form.reviewAuthorsMode === "allowlist"} onChange={() => set("reviewAuthorsMode", "allowlist")} />
                allowlist
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="mode" checked={form.reviewAuthorsMode === "all"} onChange={() => set("reviewAuthorsMode", "all")} />
                everyone
              </label>
            </div>
            {form.reviewAuthorsMode === "allowlist" && (
              <textarea
                className="field mono min-h-[4.5rem]"
                rows={3}
                value={form.reviewAuthors}
                onChange={(e) => set("reviewAuthors", e.target.value)}
                placeholder={"one GitHub login per line"}
                spellCheck={false}
              />
            )}
          </div>
        </Row>
        <Row k="review.on_push" help="Review the new commits when a reviewed PR is pushed to (incremental review).">
          <Toggle checked={form.reviewOnSynchronize} onChange={(v) => set("reviewOnSynchronize", v)} label="re-review on push" />
        </Row>
        <Row k="handle" help={`Anyone with write access can comment @${form.handle || "…"} review on any PR.`}>
          <span className="flex items-center gap-1">
            <span className="text-ink-3">@</span>
            <input className="field mono w-40" value={form.handle} onChange={(e) => set("handle", e.target.value)} spellCheck={false} />
          </span>
        </Row>
        <Row k="signature" help="Closes every review body on its own line. Leave empty for none.">
          <input className="field w-40" value={form.signature} onChange={(e) => set("signature", e.target.value)} />
        </Row>
      </Group>

      <Group title="Model" hint="What the agent runs on. The Codex chain in Credentials is what pays for it.">
        <Row k="model" help="A curated slug (gpt-sol) or a raw models.dev id (openai/gpt-5.6-sol).">
          <input className="field mono w-64" list="models" value={form.model} onChange={(e) => set("model", e.target.value)} spellCheck={false} />
          <datalist id="models">
            {MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Row>
        <Row k="effort" help="Lands on the running model's own ladder, rounding down.">
          <select className="field w-44" value={form.effort} onChange={(e) => set("effort", e.target.value)}>
            {EFFORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <Row k="agent.codex" help="Run the native Codex CLI harness instead of OpenCode. Experimental upstream; no subagents.">
          <Toggle checked={form.codexAgent} onChange={(v) => set("codexAgent", v)} label="native codex harness" />
        </Row>
      </Group>

      <Group title="Run" hint="Limits and permissions handed to the action.">
        <Row k="timeout" help="Maximum run length, e.g. 45m, 1h, 1h30m.">
          <input className="field mono w-28" value={form.timeout} onChange={(e) => set("timeout", e.target.value)} spellCheck={false} />
        </Row>
        <Row k="push" help="restricted: feature branches only; enabled: may push the default branch.">
          <TierSelect value={form.push} onChange={(v) => set("push", v)} />
        </Row>
        <Row k="shell" help="restricted filters secrets out of the environment the agent's shell sees.">
          <TierSelect value={form.shell} onChange={(v) => set("shell", v)} />
        </Row>
        <Row k="checks" help="Post the `pullfrog` check-run on the PR while a run is in flight.">
          <Toggle checked={form.statusChecks} onChange={(v) => set("statusChecks", v)} label="status check" />
        </Row>
        <Row k="comments.progress" help="Live task-list updates in the progress comment.">
          <Toggle checked={form.progressComments} onChange={(v) => set("progressComments", v)} label="progress comments" />
        </Row>
        <Row k="setup" help="Runs once after checkout, before the agent starts. Dependency installs go here.">
          <textarea className="field mono min-h-[6rem]" rows={5} value={form.setupScript} onChange={(e) => set("setupScript", e.target.value)} placeholder={"cd dashboard && pnpm install --frozen-lockfile"} spellCheck={false} />
        </Row>
        <Row k="post_checkout" help="Runs after every branch checkout the agent performs.">
          <textarea className="field mono min-h-[3.5rem]" rows={2} value={form.postCheckoutScript} onChange={(e) => set("postCheckoutScript", e.target.value)} spellCheck={false} />
        </Row>
      </Group>

      <Group title="Repository" hint="">
        <Row k="enabled" help="Off: webhooks are ignored and run-context refuses this repo.">
          <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label="frogbot enabled here" />
        </Row>
      </Group>

      <div className="sticky bottom-0 -mx-5 mt-10 flex flex-wrap items-center gap-3 border-t border-hair bg-sheet px-5 py-3 sm:mx-0 sm:px-0">
        <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty ? (
          <button type="button" className="btn btn-quiet" onClick={() => setForm(toForm(repo))}>
            Discard
          </button>
        ) : savedAt ? (
          <span className="inline-flex items-center gap-1 text-sm text-ink-2">
            <Check /> saved {ago(savedAt)}
          </span>
        ) : (
          <span className="text-sm text-ink-3">
            {repo.updatedBy ? `last changed by ${repo.updatedBy} ${ago(repo.updatedAt)}` : `unchanged since setup`}
          </span>
        )}
        {error && (
          <span role="alert" className="text-sm text-ink">
            Not saved: {error}
          </span>
        )}
      </div>
    </form>
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

function Row({ k, help, children }: { k: string; help: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 py-3 sm:grid-cols-[11rem_1fr]">
      <div className="mono pt-1.5 text-sm text-ink-2">{k}</div>
      <div>
        {children}
        <p className="mt-1 text-sm text-ink-3">{help}</p>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 pt-1 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      {label}
    </label>
  );
}

function TierSelect({ value, onChange }: { value: Tier; onChange: (v: Tier) => void }) {
  return (
    <select className="field w-40" value={value} onChange={(e) => onChange(e.target.value as Tier)}>
      <option value="disabled">disabled</option>
      <option value="restricted">restricted</option>
      <option value="enabled">enabled</option>
    </select>
  );
}
