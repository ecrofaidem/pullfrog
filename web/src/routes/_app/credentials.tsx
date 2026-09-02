// Credentials: every stored secret's health, never its value. The Codex chain
// gets the full story; API keys get a line.

import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@server/_generated/api";
import type { SecretStatus } from "@server/secrets";
import { HeadGlyph, StateGlyph } from "~/components/glyphs";
import { ago, stamp } from "~/lib/format";
import { reseedCommand } from "~/lib/health";
import { useCurrentRepo } from "~/lib/repo";

export const Route = createFileRoute("/_app/credentials")({
  component: CredentialsPage,
});

function CredentialsPage() {
  const repo = useCurrentRepo()!;
  const { data: secrets } = useSuspenseQuery(
    convexQuery(api.secrets.status, { owner: repo.owner, repo: repo.name })
  );
  const chain = secrets.find((s) => s.name === "CODEX_AUTH_JSON");
  const others = secrets.filter((s) => s.name !== "CODEX_AUTH_JSON");

  return (
    <div className="max-w-[60ch]">
      <ChainSection chain={chain} />

      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Other secrets</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Handed to every run as environment variables. Values are never shown here.
        </p>
        {others.length === 0 ? (
          <p className="mt-4 text-sm text-ink-3">
            None. Add one with <code className="text-ink-2">npx pullfrog init</code> or the CLI
            secrets endpoint.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-hair border-y border-hair">
            {others.map((s) => (
              <SecretRow key={s.id} secret={s} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ChainSection({ chain }: { chain: SecretStatus | undefined }) {
  const command = reseedCommand();
  const rejected = !!chain?.refreshRejectedAt;
  const state: "cut" | "ok" | "missing" = !chain ? "missing" : rejected ? "cut" : "ok";

  return (
    <section>
      <h2 className="text-lg font-semibold tracking-[-0.01em]">Codex subscription</h2>
      <p className="mt-0.5 text-sm text-ink-2">
        The ChatGPT refresh chain every run authenticates with. It rotates on use; the server
        refreshes it under a lease and the action writes the rotated chain back after each run.
      </p>

      <div className="mt-5 grid grid-cols-[28px_1fr] gap-x-2">
        <span className={`flex h-6 items-center justify-center ${state === "ok" ? "text-rail" : "text-ink"}`}>
          <HeadGlyph state={state === "ok" ? "ok" : "cut"} />
        </span>
        <div className="min-w-0">
          {state === "missing" && (
            <p className="text-base font-medium">No chain stored for this repo or its account.</p>
          )}
          {state === "cut" && chain && (
            <>
              <p className="text-base font-medium">Rejected by OpenAI {ago(chain.refreshRejectedAt!)}.</p>
              {chain.refreshRejectedReason && (
                <p className="mt-1 break-words text-sm text-ink-2">{chain.refreshRejectedReason}</p>
              )}
              <p className="mt-1 text-sm text-ink-2">
                Every run fails until it is reseeded. This happens after a logout from the ChatGPT
                account, a password change, or a refresh that was written back too late.
              </p>
            </>
          )}
          {state === "ok" && chain && (
            <>
              <p className="text-base text-ink">
                Healthy. Refreshed {ago(chain.lastRefreshAt ?? chain.updatedAt)}.
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                <dt className="text-ink-3">scope</dt>
                <dd className="text-ink-2">{chain.scope === "account" ? "account (shared across repos)" : "this repo"}</dd>
                <dt className="text-ink-3">last refresh</dt>
                <dd className="mono text-ink-2">{chain.lastRefreshAt ? stamp(chain.lastRefreshAt) : "not yet (seeded only)"}</dd>
                <dt className="text-ink-3">seeded</dt>
                <dd className="text-ink-2">
                  <span className="mono">{stamp(chain.updatedAt)}</span>
                  {chain.updatedBy && <span className="mono"> by {chain.updatedBy}</span>}
                </dd>
              </dl>
            </>
          )}

          <div className="mt-4">
            <p className="text-sm text-ink-2">
              {state === "ok" ? "To switch ChatGPT accounts, reseed from a checkout of the repo:" : "Reseed from a checkout of the repo:"}
            </p>
            <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-sm bg-sheet-2 px-3 py-2 text-xs text-ink">
              <code className="select-all">{command}</code>
            </pre>
            <p className="mt-1.5 text-sm text-ink-3">
              Opens a device-code login; pick account scope to share the chain across the org's
              repos. Device-code sign-in must be enabled in the ChatGPT account's security settings.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SecretRow({ secret }: { secret: SecretStatus }) {
  const remove = useMutation(api.secrets.remove);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <li className="grid grid-cols-[28px_1fr] items-start gap-x-2 py-3">
      <span className="flex h-6 items-center justify-center text-ink">
        <StateGlyph state="completed" />
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="mono text-base">{secret.name}</span>
        <span className="text-sm text-ink-2">{secret.scope === "account" ? "account" : "repo"}</span>
        <span className="text-sm text-ink-3">
          set {ago(secret.updatedAt)}
          {secret.updatedBy ? ` by ${secret.updatedBy}` : ""}
        </span>
        <span className="ml-auto">
          {confirming ? (
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="text-ink-2">remove {secret.name}?</span>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await remove({ id: secret.id });
                }}
              >
                {busy ? "Removing…" : "Remove"}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="text-sm text-ink-2 underline hover:text-ink" onClick={() => setConfirming(true)}>
              remove
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
