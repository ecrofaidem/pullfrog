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
  return new RegExp(`<(?:!--\\s*)?${h}\\s+ignore\\s*(?:--)?>`, "i").test(body ?? "");
}

/** `@<handle> review` summons the bot by comment; the `@` is optional so `frogbot review` also works. */
export function mentionRegex(handle: string): RegExp {
  return new RegExp(`(^|\\s)@?${escapeRegex(handle)}\\s+review\\b`, "i");
}
