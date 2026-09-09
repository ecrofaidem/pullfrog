import { isBot, shouldIgnorePullRequestEvent } from "../reviewPolicy";

type User = { login: string; type: string };
type Repository = { name: string; owner: { login: string }; default_branch: string };
type Installation = {
  id: number;
  account: User;
  repository_selection: string;
  suspended_at: string | null;
};
type RepoName = { name: string };

/** Only the fields consumed by dispatch.ts cross the scheduling boundary. */
export type WebhookEvent =
  | {
      event: "pull_request";
      payload: {
        action: string;
        repository: Repository;
        sender: User;
        before: string;
        pull_request: {
          number: number;
          title: string;
          body: string | null;
          draft: boolean;
          user: User;
          head: { ref: string; sha: string };
        };
      };
    }
  | {
      event: "issue_comment";
      payload: {
        action: string;
        repository: Repository;
        issue: { number: number; pull_request: Record<string, never> };
        comment: { id: number; body: string; user: User };
      };
    }
  | {
      event: "workflow_run";
      payload: {
        action: string;
        repository: Repository;
        workflow_run: {
          id: number;
          path: string;
          name: string;
          display_title: string;
          html_url: string;
          conclusion: string | null;
          run_attempt: number;
        };
      };
    }
  | {
      event: "installation";
      payload: { action: string; installation: Installation; repositories: RepoName[] };
    }
  | {
      event: "installation_repositories";
      payload: {
        action: string;
        installation: Installation;
        repositories_added: RepoName[];
        repositories_removed: RepoName[];
      };
    };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function user(value: unknown): User {
  const u = object(value);
  return { login: text(u.login), type: text(u.type) };
}
function repoNames(value: unknown): RepoName[] {
  return (Array.isArray(value) ? value : []).map((r) => {
    const repo = object(r);
    return { name: text(repo.name) || text(repo.full_name).split("/")[1] || "" };
  });
}

/** Payload-only rejection is shared by the Worker and Convex. Repo policy stays in Convex. */
export function selectWebhook(
  event: string,
  value: unknown,
  workflow: string,
): WebhookEvent | null {
  const p = object(value);
  const action = text(p.action);
  const r = object(p.repository);
  const repository: Repository = {
    name: text(r.name),
    owner: { login: text(object(r.owner).login) },
    default_branch: text(r.default_branch) || "main",
  };
  switch (event) {
    case "pull_request": {
      const pr = object(p.pull_request);
      if (!["opened", "ready_for_review", "synchronize"].includes(action) || pr.draft) return null;
      if (
        shouldIgnorePullRequestEvent({
          action,
          ...(p.sender ? { sender: object(p.sender) } : {}),
          pull_request: pr.user ? { user: object(pr.user) } : {},
        })
      )
        return null;
      return {
        event,
        payload: {
          action,
          repository,
          sender: user(object(p.sender).login == null ? pr.user : p.sender),
          before: text(p.before),
          pull_request: {
            number: Number(pr.number),
            title: text(pr.title),
            body: pr.body == null ? null : text(pr.body),
            draft: Boolean(pr.draft),
            user: user(pr.user),
            head: { ref: text(object(pr.head).ref), sha: text(object(pr.head).sha) },
          },
        },
      };
    }
    case "issue_comment": {
      const issue = object(p.issue);
      const comment = object(p.comment);
      if (
        action !== "created" ||
        !issue.pull_request ||
        isBot(comment.user ? object(comment.user) : undefined)
      )
        return null;
      // A broad candidate check supports every configurable handle. Exact matching and
      // collaborator authorization remain in dispatch.handleIssueComment.
      if (!text(comment.body).includes("@") || !/\s+review\b/i.test(text(comment.body)))
        return null;
      return {
        event,
        payload: {
          action,
          repository,
          issue: { number: Number(issue.number), pull_request: {} },
          comment: { id: Number(comment.id), body: text(comment.body), user: user(comment.user) },
        },
      };
    }
    case "workflow_run": {
      const run = object(p.workflow_run);
      if (!text(run.path).endsWith(`/${workflow}`)) return null;
      return {
        event,
        payload: {
          action,
          repository,
          workflow_run: {
            id: Number(run.id),
            path: text(run.path),
            name: text(run.name),
            display_title: text(run.display_title) || text(run.name),
            html_url: text(run.html_url),
            conclusion: run.conclusion == null ? null : text(run.conclusion),
            run_attempt: Number(run.run_attempt ?? 1),
          },
        },
      };
    }
    case "installation":
    case "installation_repositories": {
      const i = object(p.installation);
      const installation: Installation = {
        id: Number(i.id),
        account: user(i.account),
        repository_selection: text(i.repository_selection),
        suspended_at: i.suspended_at == null ? null : text(i.suspended_at),
      };
      return event === "installation"
        ? { event, payload: { action, installation, repositories: repoNames(p.repositories) } }
        : {
            event,
            payload: {
              action,
              installation,
              repositories_added: repoNames(p.repositories_added),
              repositories_removed: repoNames(p.repositories_removed),
            },
          };
    }
    default:
      return null;
  }
}
