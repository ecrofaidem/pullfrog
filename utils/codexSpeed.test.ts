import { expect, it } from "vitest";
import { advertisedCodexSpeeds, pickCodexSpeed, requestedCodexSpeed } from "./codexSpeed.ts";

it.each([
  ["pull_request_opened", "ultrafast"],
  ["pull_request_ready_for_review", "ultrafast"],
  ["pull_request_synchronize", "ultrafast"],
  ["pull_request_review_requested", "ultrafast"],
  ["pull_request_review_submitted", "standard"],
  ["pull_request_review_comment_created", "standard"],
  ["pull_request_merged", "standard"],
  ["issue_comment_created", "standard"],
  ["workflow_dispatch", "standard"],
  ["fix_review", "standard"],
  ["unknown", "standard"],
])("classifies legacy %s dispatches as %s", (trigger, expected) => {
  expect(requestedCodexSpeed("ultrafast", { event: { trigger } })).toBe(expected);
});

const catalog = JSON.stringify({ models: [
  { slug: "gpt-6.1-sol", additional_speed_tiers: ["fast", "ultrafast"] },
  { slug: "gpt-6-luna" },
] });

it.each([
  [catalog, "gpt-6.1-sol", ["fast", "ultrafast"]],
  [catalog, "gpt-6-luna", []],
  [catalog, "gpt-unknown", null],
  ["not json", "gpt-6.1-sol", null],
  ['{"models":{}}', "gpt-6.1-sol", null],
])("reads the tiers a catalog lists for a model", (json, model, tiers) => {
  expect(advertisedCodexSpeeds(json, model)).toEqual(tiers);
});

it("never raises the requested speed", () => {
  expect(pickCodexSpeed("standard", ["fast", "ultrafast"])).toBe("standard");
  expect(pickCodexSpeed("fast", ["ultrafast"])).toBe("standard");
  expect(pickCodexSpeed("fast", null)).toBe("fast");
});
