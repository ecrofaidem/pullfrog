import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { GitHubMark } from "~/components/glyphs";
import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/sign-in")({
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: SignIn,
});

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.social({ provider: "github", callbackURL: "/" });
    if (result.error) {
      setBusy(false);
      setError(result.error.message ?? "GitHub sign-in failed.");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[72ch] flex-col justify-center px-5 py-16">
      <div className="mono text-sm text-ink-2">ecrofaidem</div>
      <h1 className="mt-1 text-xl font-semibold tracking-[-0.01em]">frogbot</h1>
      <p className="mt-3 max-w-[48ch] text-base text-ink-2">
        Runs, review policy and the Codex credential for the repos frogbot is installed on.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={signIn} disabled={busy}>
          <GitHubMark />
          {busy ? "Redirecting to GitHub…" : "Continue with GitHub"}
        </button>
        <span className="text-sm text-ink-3">Members of the ecrofaidem organization only.</span>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-ink">
          {error} If you are in the org, ask an owner to grant the OAuth app access.
        </p>
      )}
    </main>
  );
}
