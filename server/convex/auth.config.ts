import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

const provider = getAuthConfigProvider();
// Self-hosted JWT validation stays inside the backend container. The token's
// issuer remains the public-facing site URL used by Better Auth.
// Convex auth analysis throws when an optional variable is absent. Its env
// proxy does not support `in`, so handle that absence at the lookup itself.
let internalSiteUrl: string | undefined;
try {
  internalSiteUrl = process.env.CONVEX_INTERNAL_SITE_URL;
} catch {
  internalSiteUrl = undefined;
}
if (internalSiteUrl) {
  provider.jwks = `${internalSiteUrl}/api/auth/convex/jwks`;
}

export default {
  providers: [provider],
} satisfies AuthConfig;
