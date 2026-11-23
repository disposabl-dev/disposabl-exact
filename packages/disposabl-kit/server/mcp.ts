import {
  createMcpHandler,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { httpActionGeneric, type HttpRouter } from "convex/server";
import { runPlatformOperation, type PlatformOperation } from "./functions";

export function registerMcp(
  router: HttpRouter,
  operations: readonly PlatformOperation[],
) {
  const handler = httpActionGeneric(async (ctx, request) => {
    // Remote MCP clients can connect without granting any browser origin access.
    const rejected = originValidationResponse(request, []);
    if (rejected) return rejected;

    return createMcpHandler(() => {
      const server = new McpServer({
        name: "disposabl-exact",
        version: "0.1.0",
      });
      for (const operation of operations) {
        server.registerTool(
          operation.name,
          {
            description: operation.description,
            inputSchema: operation.input,
            annotations: { readOnlyHint: operation.kind === "query" },
          },
          async (args) => {
            const result = await runPlatformOperation(ctx, operation, args);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent:
                result && typeof result === "object" && !Array.isArray(result)
                  ? result
                  : { result },
            };
          },
        );
      }
      return server;
    }).fetch(request);
  });

  for (const method of ["GET", "POST", "DELETE"] as const) {
    router.route({ path: "/mcp", method, handler });
  }
}
