type GitHubUser = {
  login?: unknown;
  type?: unknown;
};

type PullRequestEvent = {
  action?: unknown;
  pull_request?: { user?: GitHubUser };
  sender?: GitHubUser;
};

export function isBot(user: GitHubUser | undefined): boolean {
  if (!user) return true;
  return user.type === "Bot" || String(user.login ?? "").endsWith("[bot]");
}

export function shouldIgnorePullRequestEvent(event: PullRequestEvent): boolean {
  return isBot(event.pull_request?.user) || (event.action === "synchronize" && isBot(event.sender));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A PR whose description carries `<!-- <handle> ignore -->` (or the bare `<handle ignore>`,
 * which GitHub strips from the rendered view) gets no automatic reviews while the tag is
 * present. Comment-triggered reviews still run. GitHub sends the current body with every
 * pull_request event, so removing the tag and pushing is enough to resume.
 */
export function hasIgnoreTag(body: string | null | undefined, handle: string): boolean {
  const h = escapeRegex(handle);
  return new RegExp(`<!--\\s*${h}\\s+ignore\\s*-->|<${h}\\s+ignore>`, "i").test(body ?? "");
}

/**
 * `@<handle> <request>` summons the bot by comment and returns the request text. On a pull
 * request the `@` may be dropped for a bare `<handle> review`; other requests, and anything on
 * a plain issue, need the `@`, so ordinary prose that names the bot does not start a task.
 */
export function mentionRequest(body: string, handle: string, bareReview: boolean): string | undefined {
  const h = escapeRegex(handle);
  const bare = bareReview ? `|${h}\\s+(review\\b[\\s\\S]*)` : "";
  const m = new RegExp(`(^|\\s)(?:@${h}\\s+(\\S[\\s\\S]*)${bare})`, "i").exec(body);
  return m?.[2] ?? m?.[3];
}
