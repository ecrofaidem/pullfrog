import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";

// both URLs are public and inlined at build time, which is what lets the same
// bundle run on Workers, where there is no process.env at request time.
//
// jwtCache reads the JWT the Convex plugin sets as a cookie at sign-in and
// decodes it locally; without it every getToken() is a Worker→Convex fetch.
export const { handler, getToken, fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({
    convexUrl: import.meta.env.VITE_CONVEX_URL,
    convexSiteUrl: import.meta.env.VITE_CONVEX_SITE_URL,
    jwtCache: {
      enabled: true,
      isAuthError: (error) =>
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error as { status?: number }).status === 401,
    },
  });
