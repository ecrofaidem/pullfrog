import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";

// both URLs are public and inlined at build time, which is what lets the same
// bundle run on Workers, where there is no process.env at request time.
export const { handler, getToken, fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({
    convexUrl: import.meta.env.VITE_CONVEX_URL,
    convexSiteUrl: import.meta.env.VITE_CONVEX_SITE_URL,
  });
