import { toJsonSchema } from "@convex-dev/mcp";
import type { HttpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { siteOrigin } from "./authSettings";
import { counterTool, mcp, service } from "./mcp";

const path = "/api/counter/current";
const counter = httpAction(async (ctx, request) => {
  const user = await mcp.authenticate(ctx, request);
  if (!user || user.clientId !== undefined) {
    return Response.json({ error: "unauthorized" }, {
      status: 401, headers: { "WWW-Authenticate": "Bearer" },
    });
  }
  if (!user.scopes.includes(counterTool.scope))
    return Response.json({ error: "insufficient_scope" }, { status: 403 });
  if (request.method !== "GET")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
  if (new URL(request.url).searchParams.size)
    return Response.json({ error: "invalid_arguments" }, { status: 400 });
  return Response.json(await counterTool.handler(ctx, {}, user), { headers: { "Cache-Control": "no-store" } });
});

const openapi = httpAction(async () => {
  const { title, version } = service;
  return Response.json({
    openapi: "3.1.2",
    info: { title, version },
    servers: [{ url: siteOrigin() }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer" } } },
    paths: { [path]: { get: {
      operationId: "counter_current",
      description: counterTool.description,
      parameters: [],
      "x-required-scope": counterTool.scope,
      responses: {
        200: { description: "Success", content: { "application/json": { schema: toJsonSchema(counterTool.returns) } } },
        400: { description: "Invalid arguments" },
        401: { description: "API key missing or invalid" },
        403: { description: "API key does not allow this operation" },
      },
    } } },
  }, { headers: { "Cache-Control": "no-cache" } });
});

export function registerRest(http: HttpRouter) {
  http.route({ path, method: "GET", handler: counter });
  http.route({ path, method: "POST", handler: counter });
  http.route({ path: "/openapi.json", method: "GET", handler: openapi });
}
