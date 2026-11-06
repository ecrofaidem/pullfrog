import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

const provider = getAuthConfigProvider();
// Self-hosted JWT validation stays inside the backend container. The token's
// issuer remains the public-facing site URL used by Better Auth.
// Convex auth analysis rejects reads of absent env vars, so check presence first.
if ("CONVEX_INTERNAL_SITE_URL" in process.env && process.env.CONVEX_INTERNAL_SITE_URL) {
  provider.jwks = `${process.env.CONVEX_INTERNAL_SITE_URL}/api/auth/convex/jwks`;
}

export default {
  providers: [provider],
} satisfies AuthConfig;
