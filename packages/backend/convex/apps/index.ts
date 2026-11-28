import { ConvexError, v, type Infer } from "convex/values";
import { api, internal } from "../_generated/api";
import { action, mutation, query } from "../_generated/server";
import { requireUserId } from "../lib/requireUserId";
import { appSlugArgs, appOrNull, appPage, createdApp, createArgs, listArgs, removeArgs } from "./validators";

export const list = query({
  args: listArgs,
  returns: appPage,
  handler: async (ctx, args): Promise<Infer<typeof appPage>> =>
    ctx.runQuery(internal.apps.internal.list, { ...args, userId: await requireUserId(ctx) }),
});

export const get = query({
  args: appSlugArgs,
  returns: appOrNull,
  handler: async (ctx, args): Promise<Infer<typeof appOrNull>> =>
    ctx.runQuery(internal.apps.internal.get, { ...args, userId: await requireUserId(ctx) }),
});

export const create = action({
  args: createArgs,
  returns: createdApp,
  handler: async (ctx, args): Promise<Infer<typeof createdApp>> => {
    const userId = await ctx.runQuery(api.auth.viewerId, {});
    if (!userId) throw new ConvexError("Sign in to continue.");
    return ctx.runAction(internal.apps.actions.create.provision, { ...args, userId });
  },
});

export const remove = mutation({
  args: removeArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> =>
    ctx.runMutation(internal.apps.internal.remove, { ...args, userId: await requireUserId(ctx) }),
});
