import { ConvexError, v, type Infer } from "convex/values";
import { api, internal } from "../../_generated/api";
import { action, mutation, query } from "../../_generated/server";
import { requireUserId } from "../../lib/requireUserId";
import { disconnectProvider, readStatus } from "../internal";
import { connectLink, convexStatus } from "../validators";

export const status = query({
  args: {},
  returns: convexStatus,
  handler: async ctx => (await readStatus(ctx, await requireUserId(ctx))).convex,
});

export const connect = action({
  args: {},
  returns: connectLink,
  handler: async (ctx): Promise<Infer<typeof connectLink>> => {
    const userId = await ctx.runQuery(api.auth.viewerId, {});
    if (!userId) throw new ConvexError("Sign in to continue.");
    return ctx.runAction(internal.connections.actions.oauth.start, { userId, provider: "convex" });
  },
});

export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => disconnectProvider(ctx, await requireUserId(ctx), "convex"),
});
