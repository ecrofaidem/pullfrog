// The one sentence at HEAD. Derived on the client from what the server already
// exposes: the Codex chain's row and the latest runs.

import type { Doc } from "@server/_generated/dataModel";
import type { SecretStatus } from "@server/secrets";
import { ago } from "./format";

export type Health =
  | { kind: "ok"; line: string }
  | { kind: "cut"; line: string; detail: string; command: string }
  | { kind: "warn"; line: string; detail: string };

export function reseedCommand(): string {
  return `PULLFROG_API_URL=${import.meta.env.VITE_CONVEX_SITE_URL} npx pullfrog auth codex`;
}

export function deriveHealth(secrets: SecretStatus[], runs: Doc<"runs">[]): Health {
  const chain = secrets.find((s) => s.name === "CODEX_AUTH_JSON");
  const command = reseedCommand();

  if (!chain) {
    return {
      kind: "cut",
      line: "No Codex credential stored",
      detail: "Runs will fall back to OPENAI_API_KEY if one is set, otherwise they fail at startup.",
      command,
    };
  }
  if (chain.refreshRejectedAt) {
    return {
      kind: "cut",
      line: `Codex chain rejected ${ago(chain.refreshRejectedAt)}`,
      detail: chain.refreshRejectedReason
        ? `OpenAI refused the refresh (${chain.refreshRejectedReason.slice(0, 120)}). Every run fails until it is reseeded.`
        : "OpenAI refused the refresh. Every run fails until it is reseeded.",
      command,
    };
  }

  const settled = runs.filter((r) => r.status === "failed" || r.status === "completed").slice(0, 3);
  if (settled.length >= 2 && settled.every((r) => r.status === "failed")) {
    return {
      kind: "warn",
      line: `Last ${settled.length} runs failed`,
      detail: "The chain looks healthy, so start with the newest run's Actions log.",
    };
  }

  const fresh = chain.lastRefreshAt ?? chain.updatedAt;
  const last = runs[0];
  const parts = [`chain refreshed ${ago(fresh)}`];
  if (last) parts.push(`last run ${ago(last.createdAt)}`);
  return { kind: "ok", line: parts.join(" · ") };
}
