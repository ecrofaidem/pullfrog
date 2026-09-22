export interface Delivery {
  id: string;
  guid: string;
  delivered_at: string;
  redelivery: boolean;
  status_code: number | null;
}

export const RECOVERY_WINDOW_MS = 30 * 60 * 1000;

/** GitHub uses 64-bit delivery IDs. Preserve integer tokens before JSON.parse rounds them. */
export function parseDeliveries(source: string): Delivery[] {
  const lossless = source.replace(
    /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token: string, quoted: string | undefined) =>
      quoted || !/^-?\d+$/.test(token) || Number.isSafeInteger(Number(token))
        ? token
        : `"${token}"`,
  );
  const rows: Delivery[] = JSON.parse(lossless);
  return rows.map((row) => ({ ...row, id: String(row.id) }));
}

/** Retry recent transport/5xx failures twice, never an accepted delivery or an old replay. */
export function retryableDeliveries(deliveries: Delivery[], now: number): Delivery[] {
  const groups = new Map<string, Delivery[]>();
  for (const delivery of deliveries) {
    const group = groups.get(delivery.guid) ?? [];
    group.push(delivery);
    groups.set(delivery.guid, group);
  }
  return [...groups.values()].flatMap((group) => {
    const original = group.find((d) => !d.redelivery);
    if (!original || Date.parse(original.delivered_at) < now - RECOVERY_WINDOW_MS) return [];
    if (
      group.length >= 3 ||
      group.some((d) => d.status_code !== null && d.status_code >= 200 && d.status_code < 400)
    )
      return [];
    const latest = group.reduce((a, b) =>
      Date.parse(a.delivered_at) > Date.parse(b.delivered_at) ? a : b,
    );
    if (Date.parse(latest.delivered_at) > now - 60_000) return [];
    return latest.status_code === null || latest.status_code === 0 || latest.status_code >= 500
      ? [original]
      : [];
  });
}
