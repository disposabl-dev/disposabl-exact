import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { requireUserId } from "../lib/requireUserId";
import { app, appIdArgs, appOrNull, appPage, createArgs, listArgs, removeArgs } from "./validators";

export const list = query({
  args: listArgs,
  returns: appPage,
  handler: async (ctx, args): Promise<Infer<typeof appPage>> =>
    ctx.runQuery(internal.apps.internal.list, { ...args, userId: await requireUserId(ctx) }),
});

export const get = query({
  args: appIdArgs,
  returns: appOrNull,
  handler: async (ctx, args): Promise<Infer<typeof appOrNull>> =>
    ctx.runQuery(internal.apps.internal.get, { ...args, userId: await requireUserId(ctx) }),
});

export const create = mutation({
  args: createArgs,
  returns: app,
  handler: async (ctx, args): Promise<Infer<typeof app>> =>
    ctx.runMutation(internal.apps.internal.create, { ...args, userId: await requireUserId(ctx) }),
});

export const remove = mutation({
  args: removeArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> =>
    ctx.runMutation(internal.apps.internal.remove, { ...args, userId: await requireUserId(ctx) }),
});
