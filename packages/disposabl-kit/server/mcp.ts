import { getAuthUserId } from "@convex-dev/auth/server";
import { McpServer, tool } from "@convex-dev/mcp";
import type { FunctionReference, FunctionType } from "convex/server";
import { project } from "../../../scripts/project-config.mjs";
import { components, internal } from "../../backend/convex/_generated/api";
import { siteOrigin } from "../../backend/convex/authSettings";
import {
  createPlatformOperations,
  getPlatformValidators,
  platformScope,
  runPlatformOperation,
  type PlatformDefinition,
  type PlatformOperation,
} from "./functions";
import modules from "./generated/platforms";

const scopes = {
  read: "Read app data",
  write: "Change app data and run actions",
};
export const service = { name: "disposabl-exact", title: "Disposabl Exact", version: "0.1.0" };

const definitions: PlatformDefinition[] = [];
for (const [path, source] of Object.entries(modules)) {
  for (const [name, value] of Object.entries(source)) {
    const fn = value as {
      platforms?: true;
      isInternal?: boolean;
      isQuery?: boolean;
      isMutation?: boolean;
      isAction?: boolean;
    } | null;
    if (fn?.platforms !== true) continue;
    const id = `${path}:${name}`;
    const kind: FunctionType | undefined = fn.isQuery ? "query"
      : fn.isMutation ? "mutation"
        : fn.isAction ? "action"
          : undefined;
    if (!fn.isInternal || !kind) throw new Error(`${id}: use an internal builder from @disposabl-kit/server`);
    // Convex's generated internal API is a runtime proxy keyed by module and export.
    const reference = [...path.split("/"), name].reduce<unknown>(
      (namespace, segment) => (namespace as Record<string, unknown>)[segment],
      internal,
    ) as FunctionReference<FunctionType, "internal">;
    definitions.push({ kind, reference, ...getPlatformValidators(fn, id) } as PlatformDefinition);
  }
}

export const platformOperations = createPlatformOperations(definitions);

function createPlatformTools(operations: readonly PlatformOperation[]) {
  return Object.fromEntries(
    operations.map((operation) => [
      operation.name,
      tool({
        description: operation.description,
        args: operation.args,
        returns: operation.returns,
        annotations: { readOnlyHint: operation.kind === "query" },
        scope: platformScope(operation),
        handler: (ctx, args, user) =>
          runPlatformOperation(ctx, operation, args, user.userId),
      }),
    ]),
  );
}

export const mcp: McpServer = new McpServer(components.mcp, {
  ...service,
  siteUrl: siteOrigin(),
  consentUrl: `${siteOrigin()}/consent`,
  tools: createPlatformTools(platformOperations),
  scopes,
  deviceFlow: false,
});

function platformUser(ctx: { auth: Parameters<typeof getAuthUserId>[0]["auth"] }) {
  return "runQuery" in ctx && typeof ctx.runQuery === "function"
    ? getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0])
    : Promise.resolve(null);
}

export const { authorize } = mcp.api({
  getUserId: (ctx) => project.consent ? platformUser(ctx) : Promise.resolve(null),
});
export const { createApiKey, listConnections, revokeConnection } = mcp.api({
  getUserId: (ctx) => project.credentials ? platformUser(ctx) : Promise.resolve(null),
});
