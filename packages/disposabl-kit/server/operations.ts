import { checkValue } from "@convex-dev/mcp";
import { makeFunctionReference, type FunctionType, type GenericActionCtx, type GenericDataModel } from "convex/server";
import { asObjectValidator, v, type GenericValidator, type PropertyValidators, type Value } from "convex/values";
import { billingAvailable } from "./billing/index";
import { platform } from "./platform";
import definitions from "../../backend/platforms.generated";

type PlatformFunction = {
  args: PropertyValidators | GenericValidator;
  returns: GenericValidator;
  description?: string;
  kind: FunctionType;
  feature?: "authentication" | "payments";
  readOnly?: true;
};

const enabledFeatures = { authentication: platform.authentication, payments: billingAvailable() };

export const operations = Object.entries(definitions).map(([id, definition]) => {
  const exposed = (definition as { platform?: PlatformFunction }).platform;
  if (!exposed) throw new Error(`${id}: use an internal builder from @disposabl-kit/server`);
  const validator = asObjectValidator(exposed.args);
  if (validator.kind !== "object") throw new Error(`${id}: platform arguments must use an object validator`);
  const { userId, ...args } = validator.fields as PropertyValidators;
  if (userId && (userId.kind !== "id" || userId.tableName !== "users" || userId.isOptional !== "required")) {
    throw new Error(`${id}: userId must be v.id("users")`);
  }
  const readOnly = exposed.kind === "query" || exposed.readOnly === true;
  if (readOnly && exposed.kind === "mutation") throw new Error(`${id}: a mutation cannot be read-only`);
  return {
    id, args, returns: exposed.returns, usesUser: Boolean(userId), kind: exposed.kind,
    feature: exposed.feature,
    description: exposed.description ?? `Call ${id}.`,
    name: id.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    path: `/api/${id.replace(/\/internal:/, ":").replace(":", "/")}`,
    method: readOnly ? "GET" as const : "POST" as const,
    scope: readOnly ? "read" : "write",
  };
}).filter(operation => !operation.feature || enabledFeatures[operation.feature]);
if (new Set(operations.map(op => op.name)).size !== operations.length)
  throw new Error("Two functions have the same MCP tool name");

export type Operation = (typeof operations)[number];
export const validate = (operation: Operation, input: unknown) => checkValue(v.object(operation.args), input);

type Caller = Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation" | "runAction">;
export function invoke(ctx: Caller, operation: Operation, args: Record<string, Value>, userId?: string): Promise<Value> {
  let input = args;
  if (operation.usesUser) {
    if (!userId) throw new Error("This operation requires a user.");
    input = { ...args, userId };
  }
  const reference = <Kind extends FunctionType>() =>
    makeFunctionReference<Kind, typeof input, Value>(operation.id);
  switch (operation.kind) {
    case "query": return ctx.runQuery(reference<"query">(), input);
    case "mutation": return ctx.runMutation(reference<"mutation">(), input);
    case "action": return ctx.runAction(reference<"action">(), input);
  }
  throw new Error(`${operation.id}: unsupported Convex function type`);
}
