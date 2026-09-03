// Credentials: is the Codex chain healthy, and if not, exactly what to run.
// Healthy is one line. Everything else is behind a disclosure until it matters.

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@server/_generated/api";
import type { SecretStatus } from "@server/secrets";
import { ArrowOut, Check, CopyIcon, Dot, HeadGlyph } from "~/components/glyphs";
import { SheetSkeleton } from "~/components/skeleton";
import { relative, stamp } from "~/lib/format";
import { deriveHealth, describeUsage, reseedCommand } from "~/lib/health";
import { useNow } from "~/lib/now";
import { fullName, healthQuery, pickRepo, reposQuery, secretsQuery, useCurrentRepo } from "~/lib/repo";

export const Route = createFileRoute("/_app/credentials")({
  loaderDeps: ({ search }) => ({ repo: search.repo }),
  loader: async ({ context, deps }) => {
    const repos = await context.queryClient.ensureQueryData(reposQuery);
    const repo = pickRepo(repos, deps.repo);
    if (!repo) return;
    await Promise.all([
      context.queryClient.ensureQueryData(secretsQuery(repo)),
      context.queryClient.ensureQueryData(healthQuery(repo)),
    ]);
  },
  pendingComponent: SheetSkeleton,
  component: CredentialsPage,
});

function CredentialsPage() {
  const repo = useCurrentRepo()!;
  const { data: secrets } = useSuspenseQuery(secretsQuery(repo));
  const { data: healthData } = useSuspenseQuery(healthQuery(repo));
  const now = useNow();
  const health = deriveHealth(healthData, now);
  const chain = healthData.chain;
  const others = secrets.filter((s) => s.name !== "CODEX_AUTH_JSON");

  return (
    <div className="max-w-[60ch]">
      <h1 className="sr-only">Credentials for {fullName(repo)}</h1>
      <section aria-labelledby="chain-heading">
        <h2 id="chain-heading" className="text-lg font-semibold tracking-[-0.01em]">
          ChatGPT login
        </h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Every run signs in to ChatGPT with the saved login{" "}
          <span className="mono">CODEX_AUTH_JSON</span>. The login renews itself when a run uses
          it, and the run saves the renewed login back here.
        </p>

        <div className="mt-5 grid grid-cols-[28px_1fr] gap-x-2">
          <span className={`flex h-6 items-center justify-center ${health.kind === "ok" ? "text-rail" : "text-ink"}`}>
            <HeadGlyph state={health.kind} />
          </span>
          <div className="min-w-0">
            {health.kind === "missing" && (
              <p className="text-base font-medium">No ChatGPT login saved for this repo or its account.</p>
            )}
            {health.kind === "cut" && chain && (
              <>
                <p className="text-base font-medium">
                  OpenAI rejected the login {relative(chain.refreshRejectedAt!, now)}.
                </p>
                {chain.refreshRejectedReason && (
                  <p className="mt-1 break-words text-sm text-ink-2">{chain.refreshRejectedReason}</p>
                )}
                <p className="mt-1 text-sm text-ink-2">
                  Every run fails until someone signs in again. This happens after a sign-out from
                  the ChatGPT account, a password change, or a renewal that was not saved back in time.
                </p>
              </>
            )}
            {(health.kind === "ok" || health.kind === "warn") && chain && (
              <p className="flex flex-wrap items-baseline gap-x-2 text-base leading-6">
                <span className="font-medium text-ink">{health.rotated ? "Working." : "Saved, not renewed yet."}</span>
                <span className="text-sm text-ink-2">
                  {health.rotated
                    ? `renewed ${relative(chain.lastRefreshAt!, now)}`
                    : `saved ${relative(chain.updatedAt, now)}`}
                  {" · "}
                  {chain.scope === "account" ? "shared by all repos in the account" : "this repo only"}
                  {chain.updatedBy && (
                    <>
                      {" · "}
                      <span className="mono">{stamp(chain.updatedAt)} by {chain.updatedBy}</span>
                    </>
                  )}
                </span>
              </p>
            )}
            {health.kind === "warn" && (
              <p className="mt-1 max-w-[56ch] text-sm text-ink-2">
                {health.detail}{" "}
                {health.failedUrl && (
                  <a href={health.failedUrl} className="inline-flex items-center gap-1 text-ink hover:underline" target="_blank" rel="noreferrer">
                    Open it <ArrowOut />
                  </a>
                )}
              </p>
            )}
            {(health.kind === "ok" || health.kind === "warn") && describeUsage(healthData.usage, now) && (
              <p className="mt-1 text-sm text-ink-2">
                <UsageBar usedPercent={healthData.usage!.usedPercent} /> {describeUsage(healthData.usage, now)}
              </p>
            )}
            {health.kind === "ok" && !health.rotated && (
              <p className="mt-1 max-w-[56ch] text-sm text-ink-2">
                It renews itself on the first run that needs it.
              </p>
            )}

            <Reseed expanded={health.kind === "cut" || health.kind === "missing"} healthy={health.kind !== "cut" && health.kind !== "missing"} />
          </div>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="others-heading">
        {others.length === 0 ? (
          <div className="grid grid-cols-[28px_1fr] gap-x-2">
            <span className="flex h-6 items-center justify-center text-ink-3">
              <Dot />
            </span>
            <p className="text-sm leading-6 text-ink-3">
              <span id="others-heading">No other secrets</span> · add one with{" "}
              <code className="text-ink-2">npx pullfrog init</code>
            </p>
          </div>
        ) : (
          <>
            <h2 id="others-heading" className="text-lg font-semibold tracking-[-0.01em]">
              Other secrets
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">
              Every run gets these as environment variables. The values never appear here.
            </p>
            <ul className="mt-4 divide-y divide-hair border-y border-hair">
              {others.map((s) => (
                <SecretRow key={s.id} secret={s} now={now} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/** ten cells, filled for what is left, in the sheet's own two tones */
function UsageBar({ usedPercent }: { usedPercent: number }) {
  const filled = Math.round((100 - usedPercent) / 10);
  return (
    <span className="mono text-ink" aria-hidden>
      {"▰".repeat(filled)}
      <span className="text-ink-3">{"▱".repeat(10 - filled)}</span>
    </span>
  );
}

function Reseed({ expanded, healthy }: { expanded: boolean; healthy: boolean }) {
  const command = reseedCommand();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // the block is select-all; a failed clipboard write leaves the manual path
    }
  }

  const body = (
    <>
      <p className="text-sm text-ink-2">
        {healthy ? "To switch to a different ChatGPT account, run this from a checkout of the repo:" : "Run this from a checkout of the repo:"}
      </p>
      <div className="mt-1.5 flex items-start gap-2">
        <pre className="command min-w-0 flex-1" tabIndex={0}>
          <code className="select-all">{command}</code>
        </pre>
        <button type="button" className="btn btn-quiet shrink-0" onClick={copy} aria-live="polite">
          {copied ? <Check /> : <CopyIcon />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <p className="mt-1.5 text-sm text-ink-3">
        This opens a device sign-in page in your browser. Choose account scope to share the login with
        all repos in the org. Device sign-in must be turned on in the ChatGPT account's security settings.
      </p>
    </>
  );

  if (expanded) return <div className="mt-4">{body}</div>;
  return (
    <details className="disclosure mt-3">
      <summary>sign in again or switch account</summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}

function SecretRow({ secret, now }: { secret: SecretStatus; now: number | null }) {
  const repo = useCurrentRepo()!;
  const remove = useMutation(api.secrets.remove).withOptimisticUpdate((store, { id }) => {
    const args = { owner: repo.owner, repo: repo.name };
    const current = store.getQuery(api.secrets.status, args);
    if (current) store.setQuery(api.secrets.status, args, current.filter((s) => s.id !== id));
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doRemove() {
    setBusy(true);
    setError(null);
    try {
      await remove({ id: secret.id });
    } catch (err) {
      setError(err instanceof Error ? err.message.split("\n")[0]! : String(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="grid grid-cols-[28px_1fr] items-start gap-x-2 py-3">
      <span className="flex h-6 items-center justify-center text-ink-3">
        <Dot />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="mono text-base">{secret.name}</span>
          <span className="text-sm text-ink-2">{secret.scope === "account" ? "account" : "repo"}</span>
          <span className="text-sm text-ink-3">
            set {relative(secret.updatedAt, now)}
            {secret.updatedBy ? ` by ${secret.updatedBy}` : ""}
          </span>
          <span className="ml-auto">
            {confirming ? (
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="text-ink-2">remove {secret.name}?</span>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={doRemove}>
                  {busy ? "Removing…" : "Remove"}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="tab text-sm text-ink-2 underline hover:text-ink" onClick={() => setConfirming(true)}>
                remove
              </button>
            )}
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-sm text-ink">
            Not removed: {error}
          </p>
        )}
      </div>
    </li>
  );
}
