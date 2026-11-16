import { type AgentId, formatMcpToolRef } from "../external.ts";
import type { ResolvedPayload } from "./payload.ts";

type FilePayload = Pick<ResolvedPayload, "event" | "push" | "shell">;

export function codexSandboxMode(payload: Pick<FilePayload, "event" | "push">): "read-only" | "workspace-write" {
  return payload.event.trigger === "pull_request_merged" || payload.push !== "disabled"
    ? "workspace-write" : "read-only";
}

export function fileWriteInstructions(agentId: AgentId, payload: FilePayload, platform: NodeJS.Platform = process.platform): string {
  if (agentId !== "codex" || platform !== "linux") {
    return "Use your native file read/write/edit tools for all file operations.";
  }
  // Codex's Linux native writes fail before opening the file (openai/codex#29908).
  // The credential-filtered MCP shell is the supported editing boundary here.
  if (payload.shell === "disabled") {
    return "Read files with read_file. This run cannot change files: native apply_patch cannot write on this Linux runner and shell execution is disabled.";
  }
  const tempDirectory = process.env.PULLFROG_TEMP_DIR;
  return `Read files with read_file. Native apply_patch cannot write on this Linux runner. Create and edit files through the \`${formatMcpToolRef(agentId, "shell")}\` MCP tool, using a heredoc or Python script; commit through the git tool.` +
    (codexSandboxMode(payload) === "read-only"
      ? ` Do not modify the checkout. Write only scratch files under this run's temporary directory${tempDirectory ? `: ${JSON.stringify(tempDirectory)}` : ""}.`
      : "");
}
