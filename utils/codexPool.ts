import { randomUUID } from "node:crypto";
import * as core from "@actions/core";
import type { CodexPoolAssignment, CodexPoolDenial, CodexPoolResponse } from "./codexPoolProtocol.ts";
import { OAUTH_WRITEBACK_STATE } from "./oauthWriteback.ts";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
let runtimeInstance: string | undefined;
let cleanup: { apiToken: string; entries: []; codexPool: CodexPoolCleanup } | undefined;

export function codexPoolRuntimeInstance(): string {
  const saved = process.env.STATE_codex_pool_instance;
  runtimeInstance ??= saved && UUID.test(saved) ? saved : randomUUID();
  core.saveState("codex_pool_instance", runtimeInstance);
  return runtimeInstance;
}

export function hasExternalCodexAuth(): boolean {
  return ["CODEX_AUTH_JSON", "CODEX_API_KEY", "OPENAI_API_KEY"].some((name) => !!process.env[name]?.trim());
}

/** Only copy the supported public fields from the server response. */
export function decodeCodexPool(value: unknown, instance: string): CodexPoolResponse | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.status === "denied") {
    if (!["busy", "exhausted", "authentication", "configuration", "unknown"].includes(String(data.reason))) return null;
    return {
      status: "denied", reason: data.reason as CodexPoolDenial["reason"],
      ...(typeof data.retryAt === "number" && Number.isSafeInteger(data.retryAt) &&
        data.retryAt > 0 && data.retryAt < 8_640_000_000_000 ? { retryAt: data.retryAt } : {}),
    };
  }
  if (data.status !== "assigned" || data.version !== 1 ||
      typeof data.assignmentId !== "string" || !data.assignmentId || data.assignmentId.length > 128 ||
      typeof data.capability !== "string" || !/^[\w-]{32,512}$/.test(data.capability) ||
      typeof data.accountAlias !== "string" || !/^Account [1-9]\d*$/.test(data.accountAlias) ||
      typeof data.generation !== "number" || !Number.isSafeInteger(data.generation) || data.generation < 1 ||
      typeof data.runAttempt !== "string" || !/^[1-9]\d*$/.test(data.runAttempt) ||
      (process.env.GITHUB_RUN_ATTEMPT && data.runAttempt !== process.env.GITHUB_RUN_ATTEMPT) ||
      data.runtimeInstance !== instance) return null;
  return {
    status: "assigned", version: 1, assignmentId: data.assignmentId, capability: data.capability,
    accountAlias: data.accountAlias, generation: data.generation,
    runAttempt: data.runAttempt, runtimeInstance: instance,
  };
}

export interface CodexPoolCleanup {
  assignment: CodexPoolAssignment;
  childState: "not_started" | "running" | "stopped";
  authPath?: string;
}

/** Register post cleanup before any other startup work can fail. */
export function rememberCodexPoolAssignment(assignment: CodexPoolAssignment, apiToken: string): void {
  core.setSecret(assignment.capability);
  if (apiToken) core.setSecret(apiToken);
  const codexPool: CodexPoolCleanup = { assignment, childState: "not_started" };
  cleanup = { apiToken, entries: [], codexPool };
  core.saveState(OAUTH_WRITEBACK_STATE, JSON.stringify(cleanup));
}

/** Retain the isolated native auth file for the existing GHA post hook. */
export function registerCodexPoolAuth(authPath?: string): boolean {
  if (!cleanup) return false;
  if (!authPath) throw new Error("Codex pool auth installation failed");
  cleanup.codexPool.authPath = authPath;
  core.saveState(OAUTH_WRITEBACK_STATE, JSON.stringify(cleanup));
  return true;
}

export function markCodexPoolChild(state: "running" | "stopped"): void {
  if (!cleanup) return;
  if (state === "running" && cleanup.codexPool.childState === "running") {
    throw new Error("The previous Codex pool child has not closed");
  }
  cleanup.codexPool.childState = state;
  core.saveState(OAUTH_WRITEBACK_STATE, JSON.stringify(cleanup));
}

export function describeCodexPoolDenial(denial: CodexPoolDenial): string {
  const messages: Record<CodexPoolDenial["reason"], string> = {
    busy: "All Codex accounts are busy. Try again after a running review finishes.",
    exhausted: "The Codex accounts have no weekly quota available.",
    authentication: "The Codex accounts need attention. Inspect the pool and sign in again for rejected or uncertain accounts.",
    configuration: "Check the Codex pool membership, required-pool flag, and native Codex setting. Remove externally supplied Codex credentials.",
    unknown: "Codex quota could not be checked. Try again when the service is available.",
  };
  const retry = denial.retryAt ? ` Retry after ${new Date(denial.retryAt * 1000).toISOString()}.` : "";
  return `${messages[denial.reason]}${retry}`;
}
