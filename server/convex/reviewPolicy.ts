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
