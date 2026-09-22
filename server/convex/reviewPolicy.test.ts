import { describe, expect, it } from "vitest";
import { hasIgnoreTag, mentionRequest, shouldIgnorePullRequestEvent } from "./reviewPolicy";

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

  it("rejects half-formed delimiters", () => {
    expect(hasIgnoreTag("<!-- frogbot ignore>", "frogbot")).toBe(false);
    expect(hasIgnoreTag("<frogbot ignore -->", "frogbot")).toBe(false);
  });

  it("does not match prose that mentions ignoring", () => {
    expect(hasIgnoreTag("please have frogbot ignore the vendored files", "frogbot")).toBe(false);
  });

  it("treats a missing body as untagged", () => {
    expect(hasIgnoreTag(null, "frogbot")).toBe(false);
    expect(hasIgnoreTag(undefined, "frogbot")).toBe(false);
  });
});

describe("mentionRequest", () => {
  it("returns the request text after an @-mention", () => {
    expect(mentionRequest("@frogbot review", "frogbot", true)).toBe("review");
    expect(mentionRequest("@frogbot please fix the docs\nfor this", "frogbot", false)).toBe(
      "please fix the docs\nfor this"
    );
  });

  it("accepts a bare review request without the @ on a pull request", () => {
    expect(mentionRequest("frogbot review please", "frogbot", true)).toBe("review please");
    expect(mentionRequest("Could you\nFROGBOT review this?", "frogbot", true)).toBe("review this?");
  });

  it("ignores the bare form on a plain issue", () => {
    expect(mentionRequest("frogbot review this", "frogbot", false)).toBeUndefined();
  });

  it("requires the @ for anything other than review", () => {
    expect(mentionRequest("frogbot please fix this", "frogbot", true)).toBeUndefined();
    expect(mentionRequest("frogbot reviewed it already", "frogbot", true)).toBeUndefined();
  });

  it("requires the handle to start a word and be followed by a request", () => {
    expect(mentionRequest("notfrogbot review", "frogbot", true)).toBeUndefined();
    expect(mentionRequest("@frogbot", "frogbot", true)).toBeUndefined();
    expect(mentionRequest("@frogbot   ", "frogbot", true)).toBeUndefined();
  });
});
