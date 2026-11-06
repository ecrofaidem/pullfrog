import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function authProvider(internalSiteUrl?: string) {
  // Convex's auth evaluator exposes environment values through a get-only
  // proxy: missing reads throw, and `in` does not discover configured values.
  const env = new Proxy(process.env, {
    get(target, name) {
      if (name === "CONVEX_SITE_URL") return "https://candidate.example.test";
      if (name === "CONVEX_INTERNAL_SITE_URL") {
        if (internalSiteUrl === undefined) throw new Error("Environment variable is not set");
        return internalSiteUrl;
      }
      return Reflect.get(target, name);
    },
    has(target, name) {
      return name === "CONVEX_INTERNAL_SITE_URL" ? false : Reflect.has(target, name);
    },
  });
  vi.stubGlobal("process", { ...process, env });
  return (await import("../convex/auth.config")).default.providers[0];
}

it("deploys with the existing cloud issuer and keys when no internal URL is configured", async () => {
  expect(await authProvider()).toMatchObject({
    issuer: "https://candidate.example.test",
    jwks: "https://candidate.example.test/api/auth/convex/jwks",
  });
});

it("uses local signing keys while retaining the external issuer on self-hosted deployments", async () => {
  expect(await authProvider("http://127.0.0.1:3211")).toMatchObject({
    issuer: "https://candidate.example.test",
    jwks: "http://127.0.0.1:3211/api/auth/convex/jwks",
  });
});
