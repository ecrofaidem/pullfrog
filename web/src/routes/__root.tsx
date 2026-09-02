import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import type { ComponentProps } from "react";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouteContext,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { authClient } from "~/lib/auth-client";
import { getToken } from "~/lib/auth-server";
import appCss from "~/styles.css?url";

const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  return await getToken();
});

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "frogbot" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  beforeLoad: async (ctx) => {
    const token = await getAuth();
    if (token) ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    return { isAuthenticated: !!token, token };
  },
  component: RootComponent,
});

function RootComponent() {
  const context = useRouteContext({ from: Route.id });
  return (
    <RootDocument>
      <ConvexBetterAuthProvider
        client={context.convexQueryClient.convexClient}
        // the provider's AuthClient type is declared over an abstract plugin set
        // whose session type collapses to never; the runtime client is the one
        // the docs prescribe, so the cast only bridges the declaration.
        authClient={authClient as unknown as ComponentProps<typeof ConvexBetterAuthProvider>["authClient"]}
        initialToken={context.token}
      >
        <Outlet />
      </ConvexBetterAuthProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-sheet text-ink">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
