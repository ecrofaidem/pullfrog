import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installBundledSkills } from "./skills.ts";

const temporaryHomes: string[] = [];

function install(): string {
  const home = mkdtempSync(join(tmpdir(), "pullfrog-skills-test-"));
  temporaryHomes.push(home);
  installBundledSkills({ home });
  return home;
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("bundled report skills", () => {
  it("installs every pinned file unchanged in each supported harness directory", () => {
    const home = install();
    const manifest: { skills: Record<string, { files: Record<string, string> }> } = JSON.parse(
      readFileSync(new URL("../skills/report-skills.json", import.meta.url), "utf8")
    );
    for (const target of [".agents/skills", ".claude/skills", ".opencode/skills"]) {
      expect(readFileSync(join(home, target, "git-archaeology/SKILL.md"), "utf8")).toContain(
        "name: git-archaeology"
      );
      for (const [name, { files }] of Object.entries(manifest.skills)) {
        const directory = join(home, target, name);
        const actualFiles = readdirSync(directory, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
          .sort();
        expect(actualFiles).toEqual(Object.keys(files).sort());
        for (const [file, hash] of Object.entries(files)) {
          expect(createHash("sha256").update(readFileSync(join(directory, file))).digest("hex"))
            .toBe(hash);
        }
      }
    }
    // A repeated install must preserve the same files and remain usable.
    installBundledSkills({ home });
    expect(readFileSync(join(home, ".agents/skills/simple-english/SKILL.md"), "utf8"))
      .toContain('version: "3.0.0"');
  });

  it("runs the installed checker against a report outside the skill directory", () => {
    const home = install();
    const report = join(home, "report.md");
    writeFileSync(report, "The tests pass. The cause remains unknown.\n");
    const result = spawnSync("python3", [
      join(home, ".agents/skills/simple-english/scripts/ste_lint.py"),
      "--input-format", "auto", "--type", "mixed", report,
    ], { cwd: home, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("exposes both skills to Codex with separate checkout, HOME, and CODEX_HOME", async () => {
    const home = install();
    const codexHome = mkdtempSync(join(tmpdir(), "pullfrog-codex-config-test-"));
    const checkout = mkdtempSync(join(tmpdir(), "pullfrog-checkout-test-"));
    temporaryHomes.push(codexHome, checkout);
    const cli = new URL("../node_modules/@openai/codex/bin/codex.js", import.meta.url);
    const child = spawn(process.execPath, [cli.pathname, "app-server"], {
      cwd: checkout,
      env: { ...process.env, HOME: home, CODEX_HOME: codexHome },
      stdio: "pipe",
    });
    let stderr = "";
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    try {
      const result = await new Promise<{
        data: { skills: { name: string; path: string }[]; errors: unknown[] }[];
      }>((resolve, reject) => {
        let pending = "";
        const timeout = setTimeout(() => reject(new Error(`Codex skills/list timed out: ${stderr}`)), 20_000);
        child.on("error", (error) => { clearTimeout(timeout); reject(error); });
        child.on("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Codex exited ${code}: ${stderr}`));
        });
        child.stdout.on("data", (chunk) => {
          pending += chunk.toString();
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const message = JSON.parse(line);
            if (message.id === 1) {
              child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
              child.stdin.write(JSON.stringify({ id: 2, method: "skills/list", params: { cwds: [checkout], forceReload: true } }) + "\n");
            }
            if (message.id === 2) {
              clearTimeout(timeout);
              if (message.error) reject(new Error(JSON.stringify(message.error)));
              else resolve(message.result);
            }
          }
        });
        child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "pullfrog-skills-test", version: "1.0.0" } } }) + "\n");
      });
      expect(result.data[0].errors).toEqual([]);
      for (const name of ["write-good-docs", "simple-english"]) {
        expect(result.data[0].skills).toContainEqual(expect.objectContaining({
          name, path: join(home, ".agents/skills", name, "SKILL.md"),
        }));
      }
    } finally {
      child.stdin.end();
      child.kill();
      await closed;
    }
  }, 30_000);
});
