const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always", style: "narrow" });

/** "3m ago", "2h ago", "yesterday" — for timestamps the reader compares to now. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(s / 86_400), "day");
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** elapsed between two instants: "48s", "6m 12s", "1h 03m". */
export function duration(fromMs: number, toMs: number): string {
  const s = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function tokens(n: number | undefined): string {
  if (n === undefined) return "";
  return compact.format(n);
}

export function usd(n: number | undefined): string {
  if (n === undefined) return "";
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

export function stamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
