import { getAuthUserId } from "@convex-dev/auth/server";
import { McpServer, tool } from "@convex-dev/mcp";
import { appPlatform as platform } from "../../backend/app-platform";
import { components } from "../../backend/convex/_generated/api";
import { siteOrigin } from "../../backend/convex/authSettings";
import { runPlatformOperation } from "./functions";
import { platformOperations } from "./operations";

const scopes = {
  read: "Read app data",
  write: "Change app data and run actions",
};
export const service = { name: "disposabl-exact", title: "Disposabl Exact", version: "0.1.0" };

const tools = Object.fromEntries(platformOperations.map(operation => [
  operation.name,
  tool({
    description: operation.description,
    args: operation.args,
    returns: operation.returns,
    annotations: { readOnlyHint: operation.kind === "query" },
    scope: operation.scope,
    handler: (ctx, args, user) => runPlatformOperation(ctx, operation, args, user.userId),
  }),
]));

export const mcp: McpServer = new McpServer(components.mcp, {
  ...service,
  siteUrl: siteOrigin(),
  consentUrl: `${siteOrigin()}/consent`,
  tools,
  scopes,
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
