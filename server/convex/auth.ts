// Dashboard identity: Better Auth (Convex component) with GitHub sign-in,
// restricted to members of ALLOWED_GITHUB_ORG. The org check runs when the
// GitHub account row is about to be created, which is the one moment the
// user's OAuth access token is in hand; a non-member's half-created user row
// is deleted before the request is rejected.

import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import authConfig from "./auth.config";
import { orgMembershipState } from "./lib/github";

export const authComponent = createClient<DataModel>(components.betterAuth);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// registerRoutes() builds an auth instance while Convex analyzes the module,
// before any env is guaranteed, so config reads fall back to empty strings
// here and only `required()` calls made during a request are allowed to throw.
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL ?? "http://localhost:3000",
    database: authComponent.adapter(ctx),
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
        clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
        scope: ["read:user", "user:email", "read:org"],
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account, hookCtx) => {
            if (account.providerId !== "github") {
              throw new APIError("FORBIDDEN", { message: "GitHub sign-in only" });
            }
            const org = required("ALLOWED_GITHUB_ORG");
            const state = account.accessToken
              ? await orgMembershipState(account.accessToken, org)
              : "none";
            if (state !== "active") {
              await hookCtx?.context.internalAdapter.deleteUser(account.userId).catch(() => undefined);
              throw new APIError("FORBIDDEN", {
                message: `only members of the ${org} GitHub organization can sign in`,
              });
            }
            return { data: account };
          },
        },
      },
    },
    plugins: [convex({ authConfig })],
  });

export interface DashboardUser {
  subject: string;
  login: string;
}

/** every dashboard query and mutation starts here. */
export async function requireDashboardUser(ctx: QueryCtx | MutationCtx): Promise<DashboardUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("unauthenticated");
  const login =
    (typeof identity.nickname === "string" && identity.nickname) ||
    (typeof identity.name === "string" && identity.name) ||
    identity.subject;
  return { subject: identity.subject, login };
}
