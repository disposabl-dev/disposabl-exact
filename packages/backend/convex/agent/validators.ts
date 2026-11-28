import { vStreamArgs, vStreamUIMessagesReturnValue } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

export const conversationArgs = { appSlug: v.optional(v.string()), threadId: v.optional(v.string()) };
export const sendArgs = { ...conversationArgs, prompt: v.string() };
export const sendResult = v.object({ threadId: v.string(), messageId: v.string(), assistantMessageId: v.string() });

export const messagesArgs = { ...conversationArgs, paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs };
export const messagesResult = vStreamUIMessagesReturnValue;

export const abortArgs = { ...conversationArgs, messageId: v.string() };
export const turnArgs = { turnId: v.id("agentTurns") };
export const abortResult = v.object({ accepted: v.boolean() });
