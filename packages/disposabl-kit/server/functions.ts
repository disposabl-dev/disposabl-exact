import {
  getFunctionName,
  type FunctionReference,
  type GenericDataModel,
  type GenericQueryCtx,
  type QueryBuilder,
  type RegisteredQuery,
} from "convex/server";
import type { GenericValidator, JSONValue, Validator } from "convex/values";

type ReadResult = Record<string, JSONValue>;
type NoArgs = Record<string, never>;
type InternalRead = FunctionReference<"query", "internal", NoArgs, ReadResult>;

export function withPlatforms<DataModel extends GenericDataModel>(
  internalQuery: QueryBuilder<DataModel, "internal">,
) {
  return <Result extends ReadResult>({
    platforms,
    ...definition
  }: {
    platforms?: true;
    args: NoArgs;
    returns: Validator<Result, "required", string>;
    handler: (ctx: GenericQueryCtx<DataModel>) => Result | Promise<Result>;
  }): RegisteredQuery<"internal", NoArgs, Result | Promise<Result>> => {
    const query = internalQuery<
      NoArgs,
      GenericValidator,
      Result | Promise<Result>
    >(definition);
    return Object.assign(query, { platforms });
  };
}

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
