import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { installCodexHome } from "./codexHome.ts";
import { parseCodexAccessAuth } from "./codexAccessAuth.ts";
import { parseCodexAuthBody } from "./codexOAuth.ts";

vi.mock("./cli.ts", () => ({ log: { info: vi.fn(), warning: vi.fn() } }));
const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const auth = { auth_mode: "chatgptAuthTokens", tokens: {
  access_token: "access", id_token: "identity", account_id: "account", refresh_token: "",
} };

it("installs the host-managed mode unchanged for native Codex, without accepting it as a refresh chain", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-access-home-"));
  directories.push(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("CI", "false");
  vi.stubEnv("CODEX_AUTH_JSON", JSON.stringify(auth));
  const installed = installCodexHome();
  expect(installed).not.toBeNull();
  expect(JSON.parse(readFileSync(installed!.authPath, "utf8"))).toEqual(auth);
  expect(installed!.originalRefresh).toBe("");
  expect(parseCodexAuthBody(JSON.stringify(auth))).toBeNull();
});

it.each([
  { ...auth, tokens: { ...auth.tokens, refresh_token: "must-not-reach-child" } },
  { ...auth, tokens: { ...auth.tokens, account_id: "" } },
  { ...auth, tokens: { ...auth.tokens, id_token: null } },
])("rejects invalid access-only credentials", (value) => {
  expect(parseCodexAccessAuth(JSON.stringify(value))).toBeNull();
});
