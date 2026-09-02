// Who is signed in, for the header. Nothing more than the dashboard needs.

import { query } from "./_generated/server";
import { type DashboardUser, requireDashboardUser } from "./auth";

export const get = query({
  args: {},
  handler: async (ctx): Promise<DashboardUser> => requireDashboardUser(ctx),
});
