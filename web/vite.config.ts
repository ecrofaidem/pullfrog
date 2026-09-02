import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    // dev only: the in-app preview reaches this box through its tailnet name
    allowedHosts: true,
    // the Convex API types live in the sibling server package
    fs: { allow: [".", "../server/convex"] },
  },
  resolve: { tsconfigPaths: true },
  ssr: {
    // the Better Auth component ships TS-only entry points that must be bundled for SSR
    noExternal: ["@convex-dev/better-auth"],
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
