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
