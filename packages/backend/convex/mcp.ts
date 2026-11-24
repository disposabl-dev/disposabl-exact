import { v } from "convex/values";
import { project } from "../../../scripts/project-config.mjs";
import type { Id } from "./_generated/dataModel";
import { mcp } from "@disposabl-kit/server/mcp";
import { internalAction, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";

export { authorize, createApiKey, listConnections, revokeConnection } from "@disposabl-kit/server/mcp";

// Deployment operators can provision and revoke keys for headless apps.
export const createServiceKey = internalAction({
  args: { name: v.string(), readOnly: v.optional(v.boolean()) },
  returns: v.object({ id: v.string(), userId: v.id("users"), apiKey: v.string() }),
  handler: async (ctx, { name, readOnly }): Promise<{ id: string; userId: Id<"users">; apiKey: string }> => {
    if (!project.api && !project.mcp) throw new Error("Enable api or mcp in disposabl.json");
    const userId = await ctx.runMutation(internal.mcp.createServiceUser, { name });
    // Use the component's operator API so the credential has the same
    // hashing, scoping and revocation semantics as an interactive key.
    const { apiKey, id } = await ctx.runAction(internal.mcp.createApiKeyForUser, {
      userId, name, scopes: readOnly === false ? ["read", "write"] : ["read"],
    });
    return { id, userId, apiKey };
  },
});

export const createServiceUser = internalMutation({
  args: { name: v.string() },
  returns: v.id("users"),
  handler: (ctx, { name }) => ctx.db.insert("users", { name: name.trim().slice(0, 120) }),
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
