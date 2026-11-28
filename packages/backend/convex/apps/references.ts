import { v } from "convex/values";

export const appRef = v.object({
  appSlug: v.optional(v.string()),
  appId: v.optional(v.id("apps")),
});
