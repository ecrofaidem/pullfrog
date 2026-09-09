import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

/** The delivery claim and scheduling either both commit or both roll back. */
export const accept = internalMutation({
  args: { delivery: v.string(), event: v.string(), payload: v.any() },
  handler: async (ctx, args): Promise<boolean> => {
    const seen = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery", (q) => q.eq("deliveryId", args.delivery))
      .unique();
    if (seen) return false;
    await ctx.db.insert("webhookDeliveries", { deliveryId: args.delivery, receivedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.dispatch.handleEvent, args);
    return true;
  },
});

/** Delivery IDs cover a seven-day replay window. Review history is retained. */
export const expireDeliveries = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const expired = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(500);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === 500)
      await ctx.scheduler.runAfter(0, internal.webhooks.expireDeliveries, {});
    return { deleted: expired.length };
  },
});
