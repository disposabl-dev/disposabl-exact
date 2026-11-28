import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { requireUserId } from "../lib/requireUserId";
import { createArgs, getArgs, listArgs, preview, previewOrNull, previewPage, removeArgs } from "./validators";

export const create = mutation({
  args: createArgs,
  returns: preview,
  handler: async (ctx, args): Promise<Infer<typeof preview>> =>
    ctx.runMutation(internal.previews.internal.create, { ...args, userId: await requireUserId(ctx) }),
});

export const list = query({
  args: listArgs,
  returns: previewPage,
  handler: async (ctx, args): Promise<Infer<typeof previewPage>> =>
    ctx.runQuery(internal.previews.internal.list, { ...args, userId: await requireUserId(ctx) }),
});

export const get = query({
  args: getArgs,
  returns: previewOrNull,
  handler: async (ctx, args): Promise<Infer<typeof previewOrNull>> =>
    ctx.runQuery(internal.previews.internal.get, { ...args, userId: await requireUserId(ctx) }),
});

export const remove = mutation({
  args: removeArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> =>
    ctx.runMutation(internal.previews.internal.remove, { ...args, userId: await requireUserId(ctx) }),
});
