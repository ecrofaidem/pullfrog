import { describe, expect, it } from "vitest";
import { hasIgnoreTag, mentionRegex, shouldIgnorePullRequestEvent } from "./reviewPolicy";

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

describe("hasIgnoreTag", () => {
  it("matches the html-comment form anywhere in the body", () => {
    expect(hasIgnoreTag("Big refactor.\n\n<!-- frogbot ignore -->\n\nmore text", "frogbot")).toBe(true);
  });

  it("matches the bare tag form, case-insensitively", () => {
    expect(hasIgnoreTag("<Frogbot Ignore>", "frogbot")).toBe(true);
  });

  it("only matches the configured handle", () => {
    expect(hasIgnoreTag("<!-- otherbot ignore -->", "frogbot")).toBe(false);
    expect(hasIgnoreTag("<!-- frogbot-ignore -->", "frogbot")).toBe(false);
  });

  it("does not match prose that mentions ignoring", () => {
    expect(hasIgnoreTag("please have frogbot ignore the vendored files", "frogbot")).toBe(false);
  });

  it("treats a missing body as untagged", () => {
    expect(hasIgnoreTag(null, "frogbot")).toBe(false);
    expect(hasIgnoreTag(undefined, "frogbot")).toBe(false);
  });
});

describe("mentionRegex", () => {
  it("accepts the mention with or without the @", () => {
    expect(mentionRegex("frogbot").test("@frogbot review")).toBe(true);
    expect(mentionRegex("frogbot").test("frogbot review please")).toBe(true);
    expect(mentionRegex("frogbot").test("Could you\nFROGBOT review this?")).toBe(true);
  });

  it("requires the handle to start a word and be followed by review", () => {
    expect(mentionRegex("frogbot").test("notfrogbot review")).toBe(false);
    expect(mentionRegex("frogbot").test("@frogbot reviewed it already")).toBe(false);
    expect(mentionRegex("frogbot").test("@frogbot please review")).toBe(false);
  });
});
