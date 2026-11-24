import { v } from "convex/values";
import { appPlatform as platform } from "../app-platform";
import { mcp } from "@disposabl-kit/server/mcp";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";

export { authorize, createApiKey, listConnections, revokeConnection } from "@disposabl-kit/server/mcp";

// Create the identity once so issuing or rotating a key uses the same user ID.
export const createServiceUser = internalMutation({
  args: { name: v.string() },
  returns: v.id("users"),
  handler: (ctx, { name }) => {
    if (!platform.api && !platform.mcp) throw new Error("Enable api or mcp in disposabl.json");
    const label = name.trim();
    if (!label || label.length > 120) throw new Error("Use a service name between 1 and 120 characters");
    return ctx.db.insert("users", { name: label });
  },
});
export const { createApiKeyForUser } = mcp.internalApi();

export const revokeServiceKey = internalMutation({
  args: { userId: v.id("users"), id: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, id }) => {
    await ctx.runMutation(components.mcp.grants.revoke, { userId, grantId: id });
    return null;
  },
});
