import { v } from "convex/values";
import { project } from "@disposabl-kit/server/project-config";
import { query } from "./_generated/server";

export const features = query({
  args: {},
  returns: v.object({
    authentication: v.boolean(),
    payments: v.boolean(),
    credentials: v.boolean(),
    consent: v.boolean(),
  }),
  handler: () => {
    const { authentication, payments, credentials, consent } = project;
    return { authentication, payments, credentials, consent };
  },
});
