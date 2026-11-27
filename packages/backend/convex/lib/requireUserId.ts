import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

export async function requireUserId(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null || await ctx.db.get("users", userId) === null) {
    throw new ConvexError("Sign in to continue.");
  }
  return userId;
}
