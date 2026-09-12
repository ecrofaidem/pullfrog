/** The internal action/server contract for native Codex subscription runs. */
export const CODEX_POOL_VERSION = "1";

export type CodexPoolDenialReason =
  | "busy"
  | "exhausted"
  | "authentication"
  | "configuration"
  | "unknown";

export interface CodexPoolAssignment {
  status: "assigned";
  version: 1;
  assignmentId: string;
  /** Opaque authority for this assignment only; never include in prompts or logs. */
  capability: string;
  accountAlias: string;
  generation: number;
  runAttempt: string;
  runtimeInstance: string;
}

export interface CodexPoolDenial {
  status: "denied";
  reason: CodexPoolDenialReason;
  /** Earliest known retry/reset, in Unix seconds. */
  retryAt?: number;
}

export type CodexPoolResponse = CodexPoolAssignment | CodexPoolDenial;

export type CodexPoolFinalAuth =
  | { kind: "snapshot"; value: string }
  | { kind: "unchanged" }
  | { kind: "uncertain" };

export interface CodexPoolFinalization {
  assignmentId: string;
  childStopped: true;
  auth: CodexPoolFinalAuth;
}

export interface CodexPoolFinalizationReceipt {
  status: "released" | "quarantined" | "stale";
}

/** Private operator metadata; never includes provider identity or credentials. */
export interface CodexPoolAccountStatus {
  id: string;
  label: string;
  repo: string | null;
  enabled: boolean;
  authState: "ready" | "rejected" | "uncertain";
  busy: boolean;
  generation: number;
  credentialVersion: number;
  quota: {
    result: import("./codexQuota.ts").CodexQuotaResult;
    observedAt: number;
    fresh: boolean;
  } | null;
}

export interface CodexPoolStatus {
  accounts: CodexPoolAccountStatus[];
  pool: { enabled: boolean; accountIds: string[] } | null;
}
