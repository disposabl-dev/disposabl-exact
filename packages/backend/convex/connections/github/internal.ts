import { internalAction, internalMutation, internalQuery } from "@disposabl-kit/server";
import { v, type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import { disconnectProvider, readStatus } from "../internal";
import { connectLink, githubStatus, user } from "../validators";

export const status = internalQuery({
  platforms: true,
  description: "Get GitHub connection status.",
  args: user,
  returns: githubStatus,
  handler: async (ctx, { userId }) => (await readStatus(ctx, userId)).github,
});

export const connect = internalAction({
  platforms: true,
  description: "Get the link to connect GitHub.",
  args: user,
  returns: connectLink,
  handler: (ctx, { userId }): Promise<Infer<typeof connectLink>> =>
    ctx.runAction(internal.connections.actions.oauth.start, { userId, provider: "github" }),
});

export const disconnect = internalMutation({
  platforms: true,
  description: "Disconnect GitHub.",
  args: user,
  returns: v.null(),
  handler: (ctx, { userId }) => disconnectProvider(ctx, userId, "github"),
});
