import {
  getFunctionName,
  type FunctionReference,
  type FunctionType,
  type GenericActionCtx,
  type GenericDataModel,
} from "convex/server";
import type { GenericValidator, PropertyValidators, Value } from "convex/values";
import {
  internalAction as action,
  internalMutation as mutation,
  internalQuery as query,
} from "../../backend/convex/_generated/server";

function withPlatforms<Definition, Registered extends object>(
  builder: (definition: Definition) => Registered,
) {
  return (
    definition: Definition & {
      args: PropertyValidators;
      returns: GenericValidator;
      platforms?: true;
      description?: string;
    },
  ): Registered =>
    Object.assign(builder(definition), {
      platforms: definition.platforms,
      platformArgs: definition.args,
      platformReturns: definition.returns,
      platformDescription: definition.description,
    });
}

export const internalQuery = withPlatforms(query);
export const internalMutation = withPlatforms(mutation);
export const internalAction = withPlatforms(action);

type PlatformValidators = {
  args: PropertyValidators;
  returns: GenericValidator;
  description?: string;
};

export function getPlatformValidators(
  fn: unknown,
  id: string,
): PlatformValidators {
  const definition = fn as {
    platforms?: true;
    platformArgs?: PropertyValidators;
    platformReturns?: GenericValidator;
    platformDescription?: string;
  };
  if (
    definition.platforms !== true ||
    !definition.platformArgs ||
    !definition.platformReturns
  )
    throw new Error(
      `${id}: use an internal builder from @disposabl-kit/server with platforms: true`,
    );
  const { userId, ...args } = definition.platformArgs;
  if (
    userId?.kind !== "id" ||
    userId.tableName !== "users" ||
    userId.isOptional !== "required"
  )
    throw new Error(`${id}: platform functions require userId: v.id("users")`);
  return { args, returns: definition.platformReturns, description: definition.platformDescription };
}

export type PlatformDefinition = PlatformValidators &
  {
    [Kind in FunctionType]: {
      kind: Kind;
      reference: FunctionReference<Kind, "internal">;
    };
  }[FunctionType];

export type PlatformOperation = PlatformDefinition & {
  name: string;
  description: string;
  path: `/api/${string}`;
};

type PlatformCaller = {
  userId: string;
  scopes: readonly string[];
  clientId?: string;
};

export type AuthenticatePlatform = (
  ctx: GenericActionCtx<GenericDataModel>,
  request: Request,
) => Promise<PlatformCaller | null>;

export function platformScope(operation: PlatformOperation) {
  return operation.kind === "query" ? "read" : "write";
}

export function createPlatformOperations(
  definitions: readonly PlatformDefinition[],
): PlatformOperation[] {
  const names = new Set<string>();
  const paths = new Set<string>();
  return definitions.map((definition) => {
    const id = getFunctionName(definition.reference);
    const name = id.replace(/[^A-Za-z0-9_.-]/g, "_");
    const path = `/api/${id.replace(/\/internal:/, "/").replace(":", "/")}` as const;
    if (names.has(name) || paths.has(path)) {
      throw new Error(`${id}: duplicate platform tool name or API path`);
    }
    names.add(name);
    paths.add(path);
    return { ...definition, name, path, description: definition.description ?? `Call ${id}.` };
  });
}

export async function runPlatformOperation(
  ctx: GenericActionCtx<GenericDataModel>,
  operation: PlatformOperation,
  args: Record<string, unknown>,
  userId: string,
): Promise<Value> {
  const input = { ...args, userId };
  switch (operation.kind) {
    case "query":
      return ctx.runQuery(operation.reference, input);
    case "mutation":
      return ctx.runMutation(operation.reference, input);
    case "action":
      return ctx.runAction(operation.reference, input);
  }
}
