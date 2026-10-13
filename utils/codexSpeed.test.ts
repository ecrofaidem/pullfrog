import { expect, it } from "vitest";
import { advertisedCodexSpeeds, pickCodexSpeed } from "./codexSpeed.ts";

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
