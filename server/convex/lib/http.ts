// response helpers for the HTTP actions.

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function error(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

/** async sleep for lease polling; the Convex runtime supports timers in actions. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** path segments after a prefix, e.g. ("/api/repo/o/r/run-context", "/api/repo/") → ["o","r","run-context"] */
export function pathAfter(request: Request, prefix: string): string[] {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(prefix)) return [];
  return path
    .slice(prefix.length)
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}
