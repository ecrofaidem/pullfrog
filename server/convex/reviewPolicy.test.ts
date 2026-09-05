import { describe, expect, it } from "vitest";
import { shouldIgnorePullRequestEvent } from "./reviewPolicy";

describe("shouldIgnorePullRequestEvent", () => {
  it("ignores an event sent by a bot for a human-authored pull request", () => {
    expect(
      shouldIgnorePullRequestEvent({
        action: "synchronize",
        pull_request: { user: { login: "mt-mf-1", type: "User" } },
        sender: { login: "mf-ci-bot", type: "Bot" },
      })
    ).toBe(true);
  });

  it("allows an event sent by a human for a human-authored pull request", () => {
    expect(
      shouldIgnorePullRequestEvent({
        action: "synchronize",
        pull_request: { user: { login: "mt-mf-1", type: "User" } },
        sender: { login: "reviewer", type: "User" },
      })
    ).toBe(false);
  });

  it("continues to ignore bot-authored pull requests", () => {
    expect(
      shouldIgnorePullRequestEvent({
        action: "opened",
        pull_request: { user: { login: "dependency-bot[bot]", type: "Bot" } },
        sender: { login: "reviewer", type: "User" },
      })
    ).toBe(true);
  });

  it("does not suppress a baseline review when automation marks a human PR ready", () => {
    expect(
      shouldIgnorePullRequestEvent({
        action: "ready_for_review",
        pull_request: { user: { login: "mt-mf-1", type: "User" } },
        sender: { login: "stack-manager[bot]", type: "Bot" },
      })
    ).toBe(false);
  });

  it("recognizes bot senders by login suffix when GitHub does not mark the type", () => {
    expect(
      shouldIgnorePullRequestEvent({
        action: "synchronize",
        pull_request: { user: { login: "mt-mf-1", type: "User" } },
        sender: { login: "mf-ci-bot[bot]", type: "User" },
      })
    ).toBe(true);
  });

  it("fails closed when a synchronize event has no sender", () => {
    expect(
      shouldIgnorePullRequestEvent({
        action: "synchronize",
        pull_request: { user: { login: "mt-mf-1", type: "User" } },
      })
    ).toBe(true);
  });
});
