import { v } from "convex/values";
import { platform } from "./platform";
import {
  internalAction as action, internalMutation as mutation, internalQuery as query, query as publicQuery,
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

export const features = publicQuery({
  args: {},
  returns: v.object({
    authentication: v.boolean(),
    payments: v.boolean(),
    credentials: v.boolean(),
    consent: v.boolean(),
  }),
  handler: () => {
    const { authentication, payments, credentials, consent } = platform;
    return { authentication, payments, credentials, consent };
  },
});
