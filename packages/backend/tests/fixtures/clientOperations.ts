import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { v } from "convex/values";

const filter = v.object({ tags: v.array(v.string()) });

export const lookup = internalQuery({
  platforms: true,
  args: { name: v.string(), filter, userId: v.id("users") },
  returns: v.object({ name: v.string(), filter, userId: v.id("users") }),
  handler: (_ctx, args) => args,
});

export const echo = internalMutation({
  platforms: true,
  args: { filter },
  returns: filter,
  handler: (_ctx, { filter }) => filter,
});
