import {
  internalAction as action, internalMutation as mutation, internalQuery as query,
} from "../../backend/convex/_generated/server";

function expose<Definition, Registered>(
  builder: (definition: Definition) => Registered,
  kind: "query" | "mutation" | "action",
) {
  return (definition: Definition & {
    args: unknown;
    returns: unknown;
    description?: string;
    platforms?: true;
  }): Registered => {
    const registered = builder(definition);
    if (definition.platforms) {
      const { args, returns, description } = definition;
      Object.assign(registered as object, { platform: { args, returns, description, kind } });
    }
    return registered;
  };
}

export const internalQuery = expose(query, "query");
export const internalMutation = expose(mutation, "mutation");
export const internalAction = expose(action, "action");
