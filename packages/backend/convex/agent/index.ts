import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { requireUserId } from "../lib/requireUserId";
import { abortArgs, abortResult, messagesArgs, messagesResult, sendArgs, sendResult } from "./validators";

export const sendMessage = mutation({
  args: sendArgs,
  returns: sendResult,
  handler: async (ctx, args): Promise<Infer<typeof sendResult>> =>
    ctx.runMutation(internal.agent.internal.sendMessage, { ...args, userId: await requireUserId(ctx) }),
});

export const getMessages = query({
  args: messagesArgs,
  returns: messagesResult,
  handler: async (ctx, args): Promise<Infer<typeof messagesResult>> =>
    ctx.runQuery(internal.agent.internal.getMessages, { ...args, userId: await requireUserId(ctx) }),
});

export const abortMessage = mutation({
  args: abortArgs,
  returns: abortResult,
  handler: async (ctx, args): Promise<Infer<typeof abortResult>> =>
    ctx.runMutation(internal.agent.internal.abortMessage, { ...args, userId: await requireUserId(ctx) }),
});
