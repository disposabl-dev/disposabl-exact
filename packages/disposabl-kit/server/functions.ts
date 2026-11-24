import { makeFunctionReference, type FunctionType, type GenericActionCtx, type GenericDataModel } from "convex/server";
import type { GenericValidator, PropertyValidators, Value } from "convex/values";
import {
  internalAction as action,
  internalMutation as mutation,
  internalQuery as query,
} from "../../backend/convex/_generated/server";

type Exposure = { args: PropertyValidators; returns: GenericValidator; description?: string };

function withPlatforms<Definition, Registered extends object>(builder: (definition: Definition) => Registered) {
  return (definition: Definition & Exposure & { platforms?: true }): Registered =>
    Object.assign(builder(definition), { exposure: definition.platforms ? definition : undefined });
}

export const internalQuery = withPlatforms(query);
export const internalMutation = withPlatforms(mutation);
export const internalAction = withPlatforms(action);

export type PlatformOperation = Omit<Exposure, "description"> & {
  id: string;
  kind: FunctionType;
  name: string;
  path: `/api/${string}`;
  description: string;
  scope: "read" | "write";
};

export function createOperations(modules: Record<string, Record<string, unknown>>) {
  const operations: PlatformOperation[] = [];
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const [module, exports] of Object.entries(modules)) {
    for (const [name, value] of Object.entries(exports)) {
      const fn = value as {
        exposure?: Exposure;
        isInternal?: boolean;
        isQuery?: boolean;
        isMutation?: boolean;
        isAction?: boolean;
      } | null;
      if (!fn?.exposure) continue;
      const id = `${module}:${name}`;
      const kind = fn.isQuery ? "query" : fn.isMutation ? "mutation" : fn.isAction ? "action" : null;
      if (!fn.isInternal || !kind) throw new Error(`${id}: expose an internal Convex function`);
      const { userId, ...args } = fn.exposure.args;
      if (userId?.kind !== "id" || userId.tableName !== "users" || userId.isOptional !== "required") {
        throw new Error(`${id}: platform functions require userId: v.id("users")`);
      }
      const toolName = id.replace(/[^A-Za-z0-9_.-]/g, "_");
      const path = `/api/${id.replace(/\/internal:/, "/").replace(":", "/")}` as const;
      if (names.has(toolName) || paths.has(path)) throw new Error(`${id}: duplicate platform tool name or API path`);
      names.add(toolName);
      paths.add(path);
      operations.push({
        id, kind, name: toolName, path, args, returns: fn.exposure.returns,
        scope: kind === "query" ? "read" : "write",
        description: fn.exposure.description ?? `Call ${id}.`,
      });
    }
  }
  return operations;
}

export function runPlatformOperation(
  ctx: GenericActionCtx<GenericDataModel>,
  operation: PlatformOperation,
  args: Record<string, unknown>,
  userId: string,
): Promise<Value> {
  const input = { ...args, userId };
  switch (operation.kind) {
    case "query": return ctx.runQuery(makeFunctionReference<"query">(operation.id), input);
    case "mutation": return ctx.runMutation(makeFunctionReference<"mutation">(operation.id), input);
    case "action": return ctx.runAction(makeFunctionReference<"action">(operation.id), input);
  }
}
