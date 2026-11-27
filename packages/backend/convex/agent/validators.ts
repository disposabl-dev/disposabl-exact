import { vStreamArgs, vStreamUIMessagesReturnValue } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { appSlugArgs } from "../apps/validators";

export const sendArgs = { ...appSlugArgs, prompt: v.string() };
export const sendResult = v.object({ threadId: v.string(), messageId: v.string() });

export const messagesArgs = { ...appSlugArgs, paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs };
export const messagesResult = vStreamUIMessagesReturnValue;

export const abortArgs = { ...appSlugArgs, messageId: v.string() };
export const abortResult = v.object({ accepted: v.boolean() });
