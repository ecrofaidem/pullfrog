import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexProvider } from "convex/react";
import { SheetSkeleton } from "./components/skeleton";
import { DEV_BYPASS_AUTH } from "./lib/dev";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const convexQueryClient = new ConvexQueryClient(import.meta.env.VITE_CONVEX_URL, {
    // every dashboard query is auth-gated; wait for the token before subscribing
    // (except under the local dev bypass, where there is no token at all)
    expectAuth: !DEV_BYPASS_AUTH,
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        // a Convex subscription is torn down when react-query garbage-collects
        // the entry; never do that while the tab is open, so switching views
        // and coming back is a synchronous render from live data.
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  convexQueryClient.connect(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient, convexQueryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // with loaders warming every query, a switch is normally a pure re-render;
    // when data genuinely is not there yet, show the sheet's own skeleton fast
    defaultPendingMs: 150,
    defaultPendingMinMs: 200,
    defaultPendingComponent: SheetSkeleton,
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>{children}</ConvexProvider>
    ),
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}
