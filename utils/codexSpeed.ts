// FORK: Codex speed tiers. The repo's `codex.speed` setting is a ceiling, not
// a demand: Codex drops a tier the signed-in account's model catalog does not
// list and runs at Standard without failing, so the harness reads the catalog
// first and asks for the best tier the account really has.

export const CODEX_SPEEDS = ["standard", "fast", "ultrafast"] as const;
export type CodexSpeed = (typeof CODEX_SPEEDS)[number];

/** Only reviews use the repo's speed ceiling. Background and unclassified work stays at Standard. */
export function requestedCodexSpeed(
  setting: unknown,
  run: { type?: string | undefined; event: { trigger: string } },
): CodexSpeed {
  const review = run.type !== undefined
    ? run.type === "review" || run.type === "incremental_review"
    : ["pull_request_opened", "pull_request_ready_for_review", "pull_request_synchronize", "pull_request_review_requested"].includes(run.event.trigger);
  if (!review || run.event.trigger === "pull_request_merged") return "standard";
  if (CODEX_SPEEDS.includes(setting as CodexSpeed)) return setting as CodexSpeed;
  return process.env.PULLFROG_CODEX_FAST_MODE === "1" ? "fast" : "standard";
}

/** the tiers `codex debug models` lists for `model` as `service_tier` values; null when the catalog has no usable entry. */
export function advertisedCodexSpeeds(catalogJson: string, model: string): string[] | null {
  let catalog;
  try { catalog = JSON.parse(catalogJson); } catch { return null; }
  if (!Array.isArray(catalog?.models)) return null;
  const entry = catalog.models.find((item: { slug?: unknown }) => item?.slug === model);
  if (!entry) return null;
  const tiers = entry.additional_speed_tiers ?? [];
  return Array.isArray(tiers) ? tiers.filter((tier) => typeof tier === "string") : null;
}

/**
 * The fastest tier at or below `requested` that the account advertises.
 * An unreadable catalog (`null`) caps the request at Fast, which every paid
 * plan has had; Ultrafast is only ever sent on positive evidence.
 */
export function pickCodexSpeed(requested: CodexSpeed, advertised: readonly string[] | null): CodexSpeed {
  const ceiling = CODEX_SPEEDS.indexOf(requested);
  if (!advertised) return CODEX_SPEEDS[Math.min(ceiling, CODEX_SPEEDS.indexOf("fast"))]!;
  for (let rank = ceiling; rank > 0; rank--) {
    if (advertised.includes(CODEX_SPEEDS[rank]!)) return CODEX_SPEEDS[rank]!;
  }
  return "standard";
}

/** `config.toml` top-level and `[features]` lines for a speed; both empty at Standard. */
export function codexSpeedConfig(speed: CodexSpeed): { serviceTier: string | undefined; features: string[] } {
  if (speed === "standard") return { serviceTier: undefined, features: [] };
  return { serviceTier: speed, features: speed === "ultrafast" ? ["fast_mode", "ultrafast_mode"] : ["fast_mode"] };
}
