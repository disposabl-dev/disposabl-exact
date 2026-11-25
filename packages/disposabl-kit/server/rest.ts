import { toJsonSchema, type JSONSchema } from "@convex-dev/mcp";
import type { HttpRouter } from "convex/server";
import { convexToJson, v, type GenericValidator, type Value } from "convex/values";
import { httpAction } from "../../backend/convex/_generated/server";
import { api } from "../../backend/convex/_generated/api";
import { siteOrigin } from "./authSettings";
import { mcp, service } from "./mcp";
import { invoke, operations, validate, type Operation } from "./operations";
import { isAppRequest, readBody, reply, requestClient } from "./requests";

function plainText(field: GenericValidator | undefined) {
  return field && ["string", "id", "bytes", "int64"].includes(field.kind);
}

function queryArgs(operation: Operation, search: URLSearchParams) {
  return Object.fromEntries([...search].map(([name, value]) => {
    if (search.getAll(name).length !== 1) throw new Error("Repeated query parameter");
    return [name, plainText(operation.args[name]) ? value : JSON.parse(value)];
  }));
}

function endpoint(operation: Operation) {
  return httpAction(async (ctx, request) => {
    const user = await mcp.authenticate(ctx, request);
    if (!user || user.clientId !== undefined) {
      return Response.json({ error: "unauthorized" }, {
        status: 401, headers: { "WWW-Authenticate": "Bearer" },
      });
    }
    if (!user.scopes.includes(operation.scope)) return reply({ error: "insufficient_scope" }, 403);
    if (request.method !== operation.method) {
      return Response.json({ error: "method_not_allowed" }, {
        status: 405, headers: { Allow: operation.method },
      });
    }
    if (operation.method === "POST" && request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
      return reply({ error: "expected_json_body" }, 415);
    let input: unknown;
    try {
      input = operation.method === "GET"
        ? queryArgs(operation, new URL(request.url).searchParams)
        : await request.json();
    } catch {
      return reply({ error: "invalid_arguments" }, 400);
    }
    const parsed = validate(operation, input);
    if (!parsed.ok) return reply({ error: "invalid_arguments" }, 400);
    return Response.json(convexToJson(await invoke(ctx, operation, parsed.value as Record<string, Value>, user.userId)), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

function encodedValue(key: string): JSONSchema {
  return {
    type: "object",
    properties: { [key]: { type: "string", contentEncoding: "base64" } },
    required: [key],
    additionalProperties: false,
  };
}

function resultSchema(validator: GenericValidator): JSONSchema {
  switch (validator.kind) {
    case "int64": return encodedValue("$integer");
    case "bytes": return encodedValue("$bytes");
    case "float64": return { anyOf: [{ type: "number" }, encodedValue("$float")] };
    case "literal": return { const: convexToJson(validator.value) };
    case "array": return { type: "array", items: resultSchema(validator.element) };
    case "record": return { type: "object", additionalProperties: resultSchema(validator.value) };
    case "object": return {
      ...toJsonSchema(validator),
      properties: Object.fromEntries(Object.entries(validator.fields as Record<string, GenericValidator>)
        .map(([name, field]) => [name, resultSchema(field)])),
    };
    case "union": return { anyOf: validator.members.map(resultSchema) };
    default: return toJsonSchema(validator);
  }
}

const content = (schema: JSONSchema) => ({ "application/json": { schema } });
const openapi = httpAction(async () => {
  const { title, version } = service;
  return Response.json({
    openapi: "3.1.2",
    info: { title, version },
    servers: [{ url: siteOrigin() }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer" } } },
    paths: Object.fromEntries(operations.map(operation => [operation.path, {
      [operation.method.toLowerCase()]: {
        operationId: operation.name,
        description: operation.description,
        "x-required-scope": operation.scope,
        ...(operation.method === "GET" ? {
          parameters: Object.entries(operation.args).map(([name, field]) => ({
            name, in: "query", required: field.isOptional === "required",
            ...(plainText(field) ? { schema: toJsonSchema(field) } : { content: content(toJsonSchema(field)) }),
          })),
        } : { requestBody: { required: true, content: content(toJsonSchema(v.object(operation.args))) } }),
        responses: {
          200: { description: "Success", content: content(resultSchema(operation.returns)) },
          400: { description: "Invalid arguments" },
          401: { description: "API key missing or invalid" },
          403: { description: "API key does not allow this operation" },
        },
      },
    }])),
  }, { headers: { "Cache-Control": "no-cache" } });
});

export function registerRest(http: HttpRouter) {
  for (const operation of operations) {
    const handler = endpoint(operation);
    http.route({ path: operation.path, method: "GET", handler });
    http.route({ path: operation.path, method: "POST", handler });
  }
  http.route({ path: "/openapi.json", method: "GET", handler: openapi });
}

const appCall = httpAction(async (ctx, request) => {
  const web = new URL(request.url).pathname.endsWith("/web");
  if (!isAppRequest(request, web)) return reply({ error: "FORBIDDEN" }, 403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    return reply({ error: "EXPECTED_JSON" }, 415);
  const client = await requestClient(request, web);
  const userId = await client?.query(api.auth.viewerId, {}).catch(() => null);
  if (!userId) return reply({ error: "SIGN_IN_REQUIRED" }, 401);

  const body = await readBody(request);
  const operation = operations.find(operation => operation.id === body?.operation);
  if (!operation) return reply({ error: "NOT_FOUND" }, 404);
  const parsed = validate(operation, body?.args);
  if (!parsed.ok) return reply({ error: "INVALID_REQUEST" }, 400);
  const result = await invoke(ctx, operation, parsed.value as Record<string, Value>, userId);
  return Response.json(convexToJson(result), { headers: { "Cache-Control": "no-store" } });
});

export function registerAppOperations(http: HttpRouter, web: boolean, native: boolean) {
  if (web) http.route({ path: "/api/platform/web", method: "POST", handler: appCall });
  if (native) http.route({ path: "/api/platform/native", method: "POST", handler: appCall });
}
