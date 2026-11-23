import {
  createMcpHandler,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { httpActionGeneric, type HttpRouter } from "convex/server";
import * as z from "zod/v4";
import type { PlatformRead } from "./functions";

export function registerMcp(
  router: HttpRouter,
  reads: readonly PlatformRead[],
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
      for (const read of reads) {
        server.registerTool(
          read.name,
          {
            description: read.description,
            inputSchema: z.strictObject({}),
            annotations: { readOnlyHint: true, openWorldHint: false },
          },
          async () => {
            const result = await ctx.runQuery(read.query, {});
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
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
