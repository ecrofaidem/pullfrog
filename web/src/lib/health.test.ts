import { describe, expect, it } from "vitest";
import type { HealthData } from "../../../server/convex/health";
import type { CodexPoolAccountStatus } from "../../../utils/codexPoolProtocol";
import { deriveHealth, describePoolAccount } from "./health";

const now = 1_800_000_000_000;
const available = { id: "first", label: "Primary", repo: "bot", enabled: true, busy: false,
  authState: "ready" as const, generation: 1, credentialVersion: 1,
  quota: { fresh: true, observedAt: now, result: { status: "available" as const,
    weekly: { usedPercent: 99.6, windowSeconds: 604800, resetAt: now / 1000 + 600 } } } };
const rejected = { ...available, id: "second", label: "Secondary", authState: "rejected" as const, quota: null };
function data(accounts: CodexPoolAccountStatus[] = [available, rejected], enabled = true): HealthData {
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
  it("keeps last checked availability visible between background quota checks", () => {
    const health = deriveHealth(data(), now + 60_000);
    expect(health.kind).toBe("ok");
    expect(health.line).toContain("1 of 2 Codex accounts available at last check");
  });
  it("does not infer availability in a new quota window before it is checked", () => {
    const input = data([{ ...available, quota: { ...available.quota,
      result: { ...available.quota.result, weekly: { ...available.quota.result.weekly, resetAt: now / 1000 + 1 } } } }]);
    expect(deriveHealth(input, now + 1_000).kind).toBe("warn");
    expect(deriveHealth(input, now + 1_000).line).toContain("awaiting quota check");
  });
  it("retains availability when run cleanup invalidates the startup cache", () => {
    const account = { ...available, credentialVersion: 2, quota: { ...available.quota, fresh: false } };
    expect(deriveHealth(data([account]), now).line).toContain("1 of 1 Codex accounts available at last check");
    expect(describePoolAccount(account, now)).toContain("1% weekly remaining");
    expect(describePoolAccount(account, now)).toContain("checked just now");
  });
  it("shows both quotas from the reported production scenario after the startup cache expires", () => {
    const primary: CodexPoolAccountStatus = { ...available, quota: { ...available.quota, fresh: false,
      result: { status: "available", weekly: { ...available.quota.result.weekly, usedPercent: 0 } } } };
    const secondary: CodexPoolAccountStatus = { ...available, id: "second", quota: { ...available.quota, fresh: false,
      result: { status: "provider_denied", weekly: { ...available.quota.result.weekly, usedPercent: 100 } } } };
    expect(deriveHealth(data([primary, secondary]), now + 120_000).line).toContain("1 of 2 Codex accounts available at last check");
    expect(describePoolAccount(primary, now + 120_000)).toMatch(/100% weekly remaining.*checked 2m ago/);
    expect(describePoolAccount(secondary, now + 120_000)).toMatch(/Provider limit reached.*0% weekly remaining.*resets.*checked 2m ago/);
  });
  it("distinguishes missing and failed quota checks from exhausted accounts", () => {
    for (const quota of [null, { fresh: false, observedAt: now, result: { status: "unknown", reason: "network" } }] as const) {
      const health = deriveHealth(data([{ ...available, quota }]), now);
      expect(health.kind).toBe("warn");
      expect(health.line).toContain("1 awaiting quota check");
      expect(health.line).not.toContain("0 of 1");
    }
  });
  it("keeps quota visible while an account is busy or disabled", () => {
    for (const account of [{ ...available, busy: true }, { ...available, enabled: false }]) {
      expect(deriveHealth(data([account]), now).kind).toBe("warn");
      expect(describePoolAccount(account, now)).toContain("1% weekly remaining");
    }
  });
  it("labels a past reset as awaiting a new check while retaining the last reported quota", () => {
    const description = describePoolAccount(available, now + 600_000);
    expect(description).toContain("1% weekly remaining");
    expect(description).toContain("reset passed; awaiting quota check");
  });
  it("does not count future-dated observations as evidence of availability", () => {
    expect(deriveHealth(data(), now - 1_000).line).not.toMatch(/1 of 2 Codex accounts available/);
  });
  it("uses server freshness before the hydration clock can check the reset boundary", () => {
    const account: CodexPoolAccountStatus = { ...available, quota: { ...available.quota, fresh: false,
      result: { ...available.quota.result, weekly: { ...available.quota.result.weekly, resetAt: now / 1000 - 1 } } } };
    expect(deriveHealth(data([account]), null).kind).toBe("warn");
    expect(deriveHealth(data([account]), null).line).toContain("awaiting quota check");
    expect(describePoolAccount(account, null)).not.toContain("Available");
    expect(describePoolAccount(account, null)).toContain("1% weekly remaining");
    expect(deriveHealth(data([available]), null).kind).toBe("ok");
  });
  it("keeps legacy health while a configured pool is disabled", () => {
    expect(deriveHealth(data(undefined, false), now).kind).toBe("missing");
  });
});
