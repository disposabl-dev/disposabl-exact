import { vStreamArgs, vStreamUIMessagesReturnValue } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

export const conversationArgs = { appSlug: v.optional(v.string()), threadId: v.optional(v.string()) };
export const sendArgs = { ...conversationArgs, prompt: v.string() };
export const sendResult = v.object({ threadId: v.string(), messageId: v.string(), assistantMessageId: v.string() });

export const messagesArgs = { ...conversationArgs, paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs };
export const messagesResult = vStreamUIMessagesReturnValue;

export const abortArgs = { ...conversationArgs, messageId: v.string() };
export const turnArgs = { userId: v.id("users"), messageId: v.string() };
export const boatPrompt = v.object({ promptId: v.string(), conversationId: v.string() });
export const activeTurn = v.object({
  threadId: v.string(),
  appSlug: v.optional(v.string()),
  messageId: v.string(),
  assistantMessageId: v.string(),
  streamId: v.string(),
  deadline: v.number(),
  tokenHash: v.optional(v.string()),
  prompt: v.optional(boatPrompt),
  cursor: v.optional(v.string()),
  finishedAt: v.optional(v.number()),
  size: v.number(),
  parts: v.number(),
  cancelled: v.optional(v.boolean()),
});
export const abortResult = v.object({ accepted: v.boolean() });
