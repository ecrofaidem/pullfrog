import { Inputs, JsonPayload, resolvePayload } from "./payload.ts";
import type { RepoSettings } from "./runContext.ts";

it.each(["review", "incremental_review", "docs_update", "task", undefined])(
  "preserves dispatcher run type %s for the agent",
  (runType) => {
    const payload = resolvePayload({
      "~pullfrog": true, version: "0.1.98", type: runType, prompt: "Handle this request",
      event: { trigger: "issue_comment_created", is_pr: true },
    }, {} as RepoSettings);
    expect(payload.type).toBe(runType);
  },
);

describe("Inputs schema", () => {
  it("accepts prompt or prompt_file, both optional at the schema level", () => {
    expect(Inputs.assert({ prompt: "test prompt" })).toEqual({ prompt: "test prompt" });
    expect(Inputs.assert({ prompt_file: ".github/pullfrog/triage.md" })).toEqual({
      prompt_file: ".github/pullfrog/triage.md",
    });
    expect(() => Inputs.assert({})).not.toThrow();
  });

  it.each([
    ["push", "enabled"],
    ["push", "disabled"],
    ["push", undefined],
    ["shell", "enabled"],
    ["shell", "restricted"],
    ["shell", "disabled"],
    ["shell", undefined],
    ["timeout", "10m"],
    ["timeout", "1h30m"],
    ["timeout", "30s"],
    ["timeout", undefined],
  ] as const)("should accept %s for %s", (prop, value) => {
    const input = { prompt: "test", [prop]: value };
    expect(() => Inputs.assert(input)).not.toThrow();
  });

  it.each([["push"], ["shell"]] as const)("should reject invalid %s values", (prop) => {
    const input = { prompt: "test", [prop]: "invalid" as any };
    expect(() => Inputs.assert(input)).toThrow();
  });
});

describe("JsonPayload schema", () => {
  it("requires ~pullfrog and version and prompt", () => {
    const result = JsonPayload.assert({
      "~pullfrog": true,
      version: "1.2.3",
      prompt: "test prompt",
    });
    expect(result).toMatchObject({ "~pullfrog": true, version: "1.2.3", prompt: "test prompt" });
    expect(() => JsonPayload.assert({})).toThrow();
    expect(() => JsonPayload.assert({ "~pullfrog": true })).toThrow();
    expect(() => JsonPayload.assert({ version: "1.2.3" })).toThrow();
  });

  it.each([
    ["timeout", "10m"],
    ["timeout", "1h30m"],
    ["timeout", "30s"],
    ["model", "anthropic/claude-opus"],
    ["event", { trigger: "unknown" }],
  ] as const)("should accept optional %s with value %s", (prop, value) => {
    const input = { "~pullfrog": true, version: "1.2.3", prompt: "test prompt", [prop]: value };
    expect(() => JsonPayload.assert(input)).not.toThrow();
  });
});
