import {
  getFunctionName,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  type ActionBuilder,
  type FunctionReference,
  type GenericDataModel,
  type MutationBuilder,
  type QueryBuilder,
} from "convex/server";
import type {
  GenericValidator,
  JSONValue,
  PropertyValidators,
} from "convex/values";

export interface ServerTypes {}

type DataModel = ServerTypes extends {
  dataModel: infer Model extends GenericDataModel;
}
  ? Model
  : GenericDataModel;
type ReadResult = Record<string, JSONValue>;
type NoArgs = Record<string, never>;
type InternalRead = FunctionReference<"query", "internal", NoArgs, ReadResult>;

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
    Object.assign(builder(definition), { platforms: definition.platforms });
}

const query: QueryBuilder<DataModel, "internal"> = internalQueryGeneric;
const mutation: MutationBuilder<DataModel, "internal"> =
  internalMutationGeneric;
const action: ActionBuilder<DataModel, "internal"> = internalActionGeneric;

export const internalQuery = withPlatforms(query);
export const internalMutation = withPlatforms(mutation);
export const internalAction = withPlatforms(action);

export type PlatformRead = {
  name: string;
  description: string;
  path: `/api/${string}`;
  query: InternalRead;
};

export function createPlatformReads(
  queries: readonly InternalRead[],
): PlatformRead[] {
  return queries.map((query) => {
    const id = getFunctionName(query);
    return {
      name: id.replace(/[^A-Za-z0-9_.-]/g, "_"),
      description: `Read ${id}.`,
      path: `/api/${id.replace(/\/internal:/, "/").replace(":", "/")}`,
      query,
    };
  });
}
