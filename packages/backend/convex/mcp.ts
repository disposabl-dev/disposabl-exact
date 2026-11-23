import { getAuthUserId } from "@convex-dev/auth/server";
import { McpServer } from "@convex-dev/mcp";
import { createPlatformOperations } from "@disposabl-kit/server";
import { createPlatformTools } from "@disposabl-kit/server/mcp";
import platformDefinitions from "../generated/platforms";
import { components } from "./_generated/api";
import { siteOrigin } from "./authSettings";

export const scopes = {
  read: "Read app data",
  write: "Change app data and run actions",
};

export const platformOperations = createPlatformOperations(
  Object.values(platformDefinitions),
);

export const mcp: McpServer = new McpServer(components.mcp, {
  name: "disposabl-exact",
  title: "Disposabl Exact",
  version: "0.1.0",
  siteUrl: siteOrigin(),
  consentUrl: `${siteOrigin()}/consent`,
  tools: createPlatformTools(platformOperations),
  scopes,
  deviceFlow: false,
});

export const { authorize, createApiKey, listConnections, revokeConnection } =
  mcp.api({
    getUserId: (ctx) =>
      "runQuery" in ctx && typeof ctx.runQuery === "function"
        ? getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0])
        : Promise.resolve(null),
  });
