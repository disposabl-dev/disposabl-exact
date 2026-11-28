import { internalAction, internalMutation, internalQuery } from "@disposabl-kit/server";
import { v, type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import { disconnectProvider, readStatus } from "../internal";
import { connectLink, convexStatus, user } from "../validators";

export const status = internalQuery({
  platforms: true,
  description: "Get Convex connection status.",
  args: user,
  returns: convexStatus,
  handler: async (ctx, { userId }) => (await readStatus(ctx, userId)).convex,
});

export const connect = internalAction({
  platforms: true,
  description: "Get the link to connect Convex.",
  args: user,
  returns: connectLink,
  handler: (ctx, { userId }): Promise<Infer<typeof connectLink>> =>
    ctx.runAction(internal.connections.actions.oauth.start, { userId, provider: "convex" }),
});

export const disconnect = internalMutation({
  platforms: true,
  description: "Disconnect Convex.",
  args: user,
  returns: v.null(),
  handler: (ctx, { userId }) => disconnectProvider(ctx, userId, "convex"),
});
