import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { JSONValue, Validator } from "convex/values";

type ReadResult = Record<string, JSONValue>;

export function withPlatforms<
  TDefinition,
  TResult extends { isInternal: true; isQuery: true },
>(internalQuery: (definition: TDefinition) => TResult) {
  return (
    definition: TDefinition & {
      args: Record<string, never>;
      returns: Validator<ReadResult, "required", string>;
      platforms?: true;
    },
  ) =>
    Object.assign(internalQuery(definition), {
      platforms: definition.platforms,
    });
}

export type PlatformRead = {
  name: string;
  description: string;
  path: `/api/${string}`;
  query: FunctionReference<
    "query",
    "public",
    Record<string, never>,
    ReadResult
  >;
};

export function createPlatformReads(
  modules: Record<string, Record<string, unknown>>,
) {
  const reads: PlatformRead[] = [];
  for (const [path, exports] of Object.entries(modules)) {
    for (const [name, value] of Object.entries(exports)) {
      if (
        typeof value !== "function" ||
        !("platforms" in value) ||
        value.platforms !== true
      )
        continue;
      const id = `${path}:${name}`;
      if (!(
        "isInternal" in value &&
        value.isInternal === true &&
        "isQuery" in value &&
        value.isQuery === true
      ))
        throw new Error(`${id}: only internal queries can opt into platforms`);
      reads.push({
        name: id.replace(/[^A-Za-z0-9_.-]/g, "_"),
        description: `Read ${id}.`,
        path: `/api/${id.replace(/\/internal:/, "/").replace(":", "/")}`,
        query: makeFunctionReference(id),
      });
    }
  }
  return reads;
}
