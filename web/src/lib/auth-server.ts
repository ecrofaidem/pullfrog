import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";

// Node containers can reach Convex over the internal Docker network. Workers
// and browser clients use the Vite URLs that are inlined at build time.
//
// jwtCache reads the JWT the Convex plugin sets as a cookie at sign-in and
// decodes it locally; without it every getToken() is a Worker→Convex fetch.
export const { handler, getToken, fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({
    convexUrl: process.env.CONVEX_INTERNAL_URL || import.meta.env.VITE_CONVEX_URL,
    convexSiteUrl: process.env.CONVEX_INTERNAL_SITE_URL || import.meta.env.VITE_CONVEX_SITE_URL,
    jwtCache: {
      enabled: true,
      isAuthError: (error) =>
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error as { status?: number }).status === 401,
    },
  });
