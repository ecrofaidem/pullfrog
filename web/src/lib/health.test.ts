import { describe, expect, it } from "vitest";
import type { HealthData } from "../../../server/convex/health";
import { deriveHealth } from "./health";

const now = 1_800_000_000_000;
const available = { id: "first", label: "Primary", repo: "bot", enabled: true, busy: false,
  authState: "ready" as const, generation: 1, credentialVersion: 1,
  quota: { fresh: true, observedAt: now, result: { status: "available" as const,
    weekly: { usedPercent: 99.6, windowSeconds: 604800, resetAt: now / 1000 + 600 } } } };
const rejected = { ...available, id: "second", label: "Secondary", authState: "rejected" as const, quota: null };
function data(accounts = [available, rejected], enabled = true): HealthData {
  return { chain: null, usage: null, recent: [], codexPool: { accounts, pool: { enabled, accountIds: accounts.map((a) => a.id) } } };
}
describe("private pool health", () => {
  it("shows the usable account when another needs sign-in, without claiming every run fails", () => {
    const health = deriveHealth(data(), now);
    expect(health.kind).toBe("ok");
    expect(health.line).toContain("1 of 2");
    expect(health.line).toContain("available");
    expect(health.detail).not.toMatch(/every run fails/i);
  });
  it("ignores accounts outside ordered membership", () => {
    const input = data(); input.codexPool!.pool!.accountIds = ["second"];
    expect(deriveHealth(input, now).kind).toBe("cut");
  });
  it("reports busy occupancy separately from missing credentials", () => {
    const health = deriveHealth(data([{ ...available, busy: true }]), now);
    expect(health.kind).toBe("warn");
    expect(health.line).toMatch(/busy/);
  });
  it("does not present cached availability after the cache age or reset boundary", () => {
    expect(deriveHealth(data(), now + 60_000).kind).toBe("warn");
    const input = data([{ ...available, quota: { ...available.quota,
      result: { ...available.quota.result, weekly: { ...available.quota.result.weekly, resetAt: now / 1000 + 1 } } } }]);
    expect(deriveHealth(input, now + 1_000).kind).toBe("warn");
  });
  it("keeps legacy health while a configured pool is disabled", () => {
    expect(deriveHealth(data(undefined, false), now).kind).toBe("missing");
  });
});
