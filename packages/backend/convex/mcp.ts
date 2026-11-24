import { v } from "convex/values";
import { McpServer, tool, type ToolCtx } from "@convex-dev/mcp";
import { getAuthUserId } from "@convex-dev/auth/server";
import { appPlatform as platform } from "../app-platform";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { siteOrigin } from "./authSettings";
import { invoke, operations } from "./operations";
import type { Value } from "convex/values";

export const service = { name: "disposabl-exact", title: "Disposabl Exact", version: "0.1.0" };
const tools = Object.fromEntries(operations.map(operation => [
  operation.name,
  tool({
    args: operation.args, returns: operation.returns, description: operation.description,
    scope: operation.scope, annotations: { readOnlyHint: operation.kind === "query" },
    handler: (ctx, args, user) => invoke(ctx, operation, args as Record<string, Value>, user.userId),
  }),
]));

class AppMcpServer extends McpServer {
  override async authenticate(ctx: ToolCtx, request: Request) {
    const user = await super.authenticate(ctx, request);
    return !platform.consent && user?.clientId !== undefined ? null : user;
  }
}

export const mcp: McpServer = new AppMcpServer(components.mcp, {
  ...service,
  siteUrl: siteOrigin(),
  consentUrl: `${siteOrigin()}/consent`,
  tools,
  scopes: { read: "Read app data", write: "Change app data and run actions" },
  deviceFlow: false,
});

function platformUser(ctx: { auth: Parameters<typeof getAuthUserId>[0]["auth"] }) {
  return "runQuery" in ctx && typeof ctx.runQuery === "function"
    ? getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0])
    : Promise.resolve(null);
}

export const { authorize } = mcp.api({
  getUserId: (ctx) => platform.consent ? platformUser(ctx) : Promise.resolve(null),
});
export const { createApiKey, listConnections, revokeConnection } = mcp.api({
  getUserId: (ctx) => platform.credentials ? platformUser(ctx) : Promise.resolve(null),
});

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
