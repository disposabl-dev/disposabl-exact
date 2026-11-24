import { toJsonSchema, type JSONSchema } from "@convex-dev/mcp";
import { convexToJson, v, type GenericValidator } from "convex/values";
import { platformScope, type PlatformOperation } from "./functions";

export function isTextParameter(validator: GenericValidator | undefined) {
  return validator?.kind === "string" || validator?.kind === "id" ||
    validator?.kind === "bytes" || validator?.kind === "int64";
}

const base64 = { type: "string", contentEncoding: "base64" };
function encodedValue(key: string) {
  return {
    type: "object",
    properties: { [key]: base64 },
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
      properties: Object.fromEntries(
        Object.entries(validator.fields as Record<string, GenericValidator>)
          .map(([name, field]) => [name, resultSchema(field)]),
      ),
    };
    case "union": return { anyOf: validator.members.map(resultSchema) };
    default: return toJsonSchema(validator);
  }
}

function jsonContent(schema: JSONSchema) {
  return { "application/json": { schema } };
}

export function createOpenApi(
  operations: readonly PlatformOperation[],
  info: { title: string; version: string },
  origin: string,
) {
  return {
    openapi: "3.1.2",
    info,
    servers: [{ url: origin }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Create a scoped API key in /api-keys.",
        },
      },
    },
    paths: Object.fromEntries(operations.map((operation) => {
      const query = operation.kind === "query";
      return [operation.path, {
        [query ? "get" : "post"]: {
          operationId: operation.name,
          description: operation.description,
          "x-required-scope": platformScope(operation),
          ...(query ? {
            parameters: Object.entries(operation.args).map(([name, field]) => {
              const schema = toJsonSchema(field);
              return {
                name,
                in: "query",
                required: field.isOptional !== "optional",
                ...(isTextParameter(field) ? { schema } : { content: jsonContent(schema) }),
              };
            }),
          } : {
            requestBody: { required: true, content: jsonContent(toJsonSchema(v.object(operation.args))) },
          }),
          responses: {
            "200": { description: "Success", content: jsonContent(resultSchema(operation.returns)) },
            "400": { description: "Invalid arguments" },
            "401": { description: "API key missing or invalid" },
            "403": { description: "API key does not allow this operation" },
            ...(query ? {} : { "415": { description: "Expected application/json" } }),
          },
        },
      }];
    })),
  };
}
