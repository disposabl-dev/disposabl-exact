import { ConvexError, v, type Infer } from "convex/values";
import { api, internal } from "../../_generated/api";
import { action, mutation, query } from "../../_generated/server";
import { requireUserId } from "../../lib/requireUserId";
import { disconnectProvider, readStatus } from "../internal";
import { connectLink, githubStatus } from "../validators";

export const status = query({
  args: {},
  returns: githubStatus,
  handler: async ctx => (await readStatus(ctx, await requireUserId(ctx))).github,
});

export const connect = action({
  args: {},
  returns: connectLink,
  handler: async (ctx): Promise<Infer<typeof connectLink>> => {
    const userId = await ctx.runQuery(api.auth.viewerId, {});
    if (!userId) throw new ConvexError("Sign in to continue.");
    return ctx.runAction(internal.connections.actions.oauth.start, { userId, provider: "github" });
  },
});

export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => disconnectProvider(ctx, await requireUserId(ctx), "github"),
});
