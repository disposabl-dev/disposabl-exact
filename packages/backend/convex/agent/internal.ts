import { abortStream, createThread, listUIMessages, saveMessage, syncStreams } from "@convex-dev/agent";
import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v } from "convex/values";
import { components } from "../_generated/api";
import { requireOwnedApp } from "../apps/internal";
import { abortArgs, abortResult, messagesArgs, messagesResult, sendArgs, sendResult } from "./validators";

const identity = { userId: v.id("users") };

export const sendMessage = internalMutation({
  platforms: true,
  description: "Save a user message to an app's conversation.",
  args: { ...identity, ...sendArgs },
  returns: sendResult,
  handler: async (ctx, { userId, appId, prompt }) => {
    const app = await requireOwnedApp(ctx, userId, appId);
    const text = prompt.trim();
    if (!text || text.length > 32_000) throw new ConvexError("Message must be 1–32,000 characters.");

    const threadId = app.agentThreadId ?? await createThread(ctx, components.agent, { userId, title: app.name });
    if (!app.agentThreadId) await ctx.db.patch("apps", appId, { agentThreadId: threadId });
    const { messageId } = await saveMessage(ctx, components.agent, { threadId, userId, prompt: text });
    return { threadId, messageId };
  },
});

export const getMessages = internalQuery({
  platforms: true,
  description: "Read messages from an app's conversation.",
  args: { ...identity, ...messagesArgs },
  returns: messagesResult,
  handler: async (ctx, { userId, appId, paginationOpts, streamArgs }) => {
    const { agentThreadId: threadId } = await requireOwnedApp(ctx, userId, appId);
    if (!threadId) return { page: [], isDone: true, continueCursor: "" };

    const page = await listUIMessages(ctx, components.agent, { threadId, paginationOpts });
    const streams = await syncStreams(ctx, components.agent, { threadId, streamArgs });
    return { ...page, streams };
  },
});

export const abortMessage = internalMutation({
  platforms: true,
  description: "Stop an active stream for a message in an app's conversation.",
  args: { ...identity, ...abortArgs },
  returns: abortResult,
  handler: async (ctx, { userId, appId, messageId }) => {
    const { agentThreadId: threadId } = await requireOwnedApp(ctx, userId, appId);
    if (!threadId) return { accepted: false };
    const [message] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [messageId] });
    if (message?.threadId !== threadId || message.message?.role !== "user") return { accepted: false };

    const accepted = await abortStream(ctx, components.agent, { threadId, order: message.order, reason: "Stopped by user" });
    return { accepted };
  },
});
