import { expect, it } from "vitest";
import { advertisedCodexSpeeds, capForWeeklyLimit, DEFAULT_SPEED_FALLBACK_BELOW, pickCodexSpeed, requestedCodexSpeed } from "./codexSpeed.ts";

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

it.each([
  // requested, used %, fallback setting, applied, reason
  ["ultrafast", 50, undefined, "ultrafast", undefined],
  ["ultrafast", 91, undefined, "fast", "weekly limit 9% left, below 10%"],
  ["ultrafast", 90, undefined, "ultrafast", undefined],
  ["ultrafast", 85, 20, "fast", "weekly limit 15% left, below 20%"],
  ["ultrafast", 99, 0, "ultrafast", undefined],
  ["ultrafast", null, undefined, "fast", "weekly limit unknown"],
  ["ultrafast", null, 0, "ultrafast", undefined],
  ["ultrafast", 95, "20", "fast", "weekly limit 5% left, below 10%"],
  ["ultrafast", 95, 101, "fast", "weekly limit 5% left, below 10%"],
  ["fast", 99, undefined, "fast", undefined],
  ["standard", null, undefined, "standard", undefined],
] as const)("%s at %s%% used with fallback %s runs at %s", (requested, used, fallback, speed, reason) => {
  expect(capForWeeklyLimit(requested, used === null ? null : { usedPercent: used }, fallback)).toEqual(reason ? { speed, reason } : { speed });
});

it("falls back below 10% by default", () => {
  expect(DEFAULT_SPEED_FALLBACK_BELOW).toBe(10);
});
