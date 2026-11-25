import { v } from "convex/values";
import { appPlatform } from "./app-platform";
import { query } from "../../backend/convex/_generated/server";

export const features = query({
  args: {},
  returns: v.object({
    authentication: v.boolean(),
    payments: v.boolean(),
    credentials: v.boolean(),
    consent: v.boolean(),
  }),
  handler: () => {
    const { authentication, payments, credentials, consent } = appPlatform;
    return { authentication, payments, credentials, consent };
  },
});
