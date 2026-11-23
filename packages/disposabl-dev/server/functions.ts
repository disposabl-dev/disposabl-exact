import type { FunctionReference } from "convex/server";

/** Opt in an existing public, argument-free query to HTTP and MCP. */
export type PublicRead = {
  name: string;
  description: string;
  path: `/api/${string}`;
  query: FunctionReference<
    "query",
    "public",
    Record<string, never>,
    Record<string, unknown>
  >;
};
