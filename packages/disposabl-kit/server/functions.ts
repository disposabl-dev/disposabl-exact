import {
  getFunctionName,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  type ActionBuilder,
  type FunctionReference,
  type FunctionType,
  type GenericActionCtx,
  type GenericDataModel,
  type MutationBuilder,
  type QueryBuilder,
} from "convex/server";
import type {
  GenericValidator,
  JSONValue,
  PropertyValidators,
  Value,
} from "convex/values";
import { convexToJson } from "convex/values";
import * as z from "zod/v4";

export interface ServerTypes {}

type DataModel = ServerTypes extends {
  dataModel: infer Model extends GenericDataModel;
}
  ? Model
  : GenericDataModel;

function withPlatforms<Definition, Registered extends object>(
  builder: (definition: Definition) => Registered,
) {
  return (
    definition: Definition & {
      args: PropertyValidators;
      returns: GenericValidator;
      platforms?: true;
    },
  ): Registered =>
    Object.assign(builder(definition), {
      platforms: definition.platforms,
      platformArgs: definition.args,
    });
}

const query: QueryBuilder<DataModel, "internal"> = internalQueryGeneric;
const mutation: MutationBuilder<DataModel, "internal"> =
  internalMutationGeneric;
const action: ActionBuilder<DataModel, "internal"> = internalActionGeneric;

export const internalQuery = withPlatforms(query);
export const internalMutation = withPlatforms(mutation);
export const internalAction = withPlatforms(action);

export type PlatformDefinition = {
  [Kind in FunctionType]: {
    kind: Kind;
    reference: FunctionReference<Kind, "internal">;
    inputSchema: z.core.JSONSchema.ObjectSchema;
  };
}[FunctionType];

export type PlatformOperation = PlatformDefinition & {
  name: string;
  description: string;
  path: `/api/${string}`;
  input: z.ZodType<Record<string, unknown>>;
};

export function createPlatformOperations(
  definitions: readonly PlatformDefinition[],
): PlatformOperation[] {
  return definitions.map((definition) => {
    const id = getFunctionName(definition.reference);
    return {
      ...definition,
      name: id.replace(/[^A-Za-z0-9_.-]/g, "_"),
      description: `Call ${id}.`,
      path: `/api/${id.replace(/\/internal:/, "/").replace(":", "/")}`,
      input: z.fromJSONSchema(
        definition.inputSchema,
      ) as PlatformOperation["input"],
    };
  });
}

export async function runPlatformOperation(
  ctx: GenericActionCtx<GenericDataModel>,
  operation: PlatformOperation,
  args: Record<string, unknown>,
): Promise<JSONValue> {
  let result: Value;
  switch (operation.kind) {
    case "query":
      result = await ctx.runQuery(operation.reference, args);
      break;
    case "mutation":
      result = await ctx.runMutation(operation.reference, args);
      break;
    case "action":
      result = await ctx.runAction(operation.reference, args);
      break;
  }
  return convexToJson(result);
}
