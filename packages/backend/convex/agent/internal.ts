import { createThread, getThreadMetadata, listUIMessages, saveMessage, syncStreams } from "@convex-dev/agent";
import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation as mutation, internalQuery as query, type QueryCtx } from "../_generated/server";
import { ownedApp, requireOwnedApp } from "../apps/internal";
import { findConnection } from "../connections/internal";
import { abortArgs, abortResult, activeTurn, boatPrompt, messagesArgs, messagesResult, sendArgs, sendResult, turnArgs } from "./validators";

const identity = { userId: v.id("users") };
const turnLifetime = 30 * 60_000;
const textId = "assistant";

async function conversation(ctx: QueryCtx, userId: Id<"users">, appSlug?: string, suppliedThread?: string) {
  const app = appSlug ? await requireOwnedApp(ctx, userId, appSlug) : null;
  if (suppliedThread) {
    const thread = await getThreadMetadata(ctx, components.agent, { threadId: suppliedThread }).catch(() => null);
    if (thread?.userId !== userId || (app && app.agentThreadId !== suppliedThread)) {
      throw new ConvexError("Conversation not found.");
    }
  }
  return { app, threadId: suppliedThread ?? app?.agentThreadId };
}

export const sendMessage = internalMutation({
  platforms: true,
  description: "Send a message to the coding agent.",
  args: { ...identity, ...sendArgs },
  returns: sendResult,
  handler: async (ctx, { userId, appSlug, threadId: suppliedThread, prompt }) => {
    const text = prompt.trim();
    if (!text || text.length > 32_000) throw new ConvexError("Message must be 1–32,000 characters.");
    const user = await ctx.db.get("users", userId);
    if (!user) throw new ConvexError("Account not found.");
    if (user.agentTurn) throw new ConvexError("Wait for the current message or stop it before sending another.");

    const target = await conversation(ctx, userId, appSlug, suppliedThread);
    const threadId = target.threadId ?? await createThread(ctx, components.agent, { userId, title: target.app?.name });
    if (target.app && !target.app.agentThreadId) await ctx.db.patch("apps", target.app._id, { agentThreadId: threadId });
    const app = target.app ?? await ctx.db.query("apps")
      .withIndex("by_agentThreadId", q => q.eq("agentThreadId", threadId)).first();

    const { messageId, message } = await saveMessage(ctx, components.agent, { threadId, userId, prompt: text });
    const { messageId: assistantMessageId, message: assistant } = await saveMessage(ctx, components.agent, {
      threadId, userId, promptMessageId: messageId, message: { role: "assistant", content: "" },
      metadata: { status: "pending" },
    });
    const streamId = await ctx.runMutation(components.agent.streams.create, {
      threadId, userId, order: message.order, stepOrder: assistant.stepOrder,
      agentName: "Codex", provider: "openai", format: "UIMessageChunk",
    });
    await ctx.runMutation(components.agent.streams.addDelta, {
      streamId, start: 0, end: 2, parts: [{ type: "start", messageId: `stream:${streamId}` }, { type: "text-start", id: textId }],
    });
    const turn = { threadId, appSlug: app?.userId === userId ? app.slug : undefined, messageId, assistantMessageId, streamId,
      parts: 2, size: 0, deadline: Date.now() + turnLifetime };
    await ctx.db.patch("users", userId, { agentTurn: turn });
    const run = internal.agent.actions.run.processTurn;
    await ctx.scheduler.runAfter(0, run, { userId, messageId });
    await ctx.scheduler.runAfter(turnLifetime, internal.agent.actions.run.expire, { userId, messageId });
    return { threadId, messageId, assistantMessageId };
  },
});

export const getMessages = internalQuery({
  platforms: true,
  description: "Read conversation messages and stream deltas by app slug or thread ID.",
  args: { ...identity, ...messagesArgs },
  returns: messagesResult,
  handler: async (ctx, { userId, appSlug, threadId: suppliedThread, paginationOpts, streamArgs }) => {
    const { threadId } = await conversation(ctx, userId, appSlug, suppliedThread);
    if (!threadId) return { page: [], isDone: true, continueCursor: "" };
    return {
      ...await listUIMessages(ctx, components.agent, { threadId, paginationOpts }),
      streams: await syncStreams(ctx, components.agent, { threadId, streamArgs }),
    };
  },
});

export const abortMessage = internalMutation({
  platforms: true,
  description: "Stop the active coding agent turn.",
  args: { ...identity, ...abortArgs },
  returns: abortResult,
  handler: async (ctx, { userId, appSlug, threadId: suppliedThread, messageId }) => {
    const { threadId } = await conversation(ctx, userId, appSlug, suppliedThread);
    const turn = await active(ctx, { userId, messageId });
    if (!turn || turn.threadId !== threadId) return { accepted: false };
    await ctx.db.patch("users", userId, { agentTurn: { ...turn, cancelled: true, tokenHash: undefined } });
    return { accepted: true };
  },
});

async function active(ctx: QueryCtx, { userId, messageId }: { userId: Id<"users">; messageId: string }) {
  const turn = (await ctx.db.get("users", userId))?.agentTurn;
  return turn?.messageId === messageId ? turn : null;
}

export const getTurn = query({ args: turnArgs, returns: v.union(activeTurn, v.null()), handler: active });

export const getConversation = query({
  args: turnArgs,
  returns: v.union(v.null(), v.object({ repository: v.optional(v.string()), history: v.array(v.object({ role: v.string(), text: v.string() })) })),
  handler: async (ctx, args) => {
    const turn = await active(ctx, args);
    if (!turn) return null;
    const { userId } = args;
    const app = turn.appSlug && await ownedApp(ctx, userId, turn.appSlug);
    const { page } = await listUIMessages(ctx, components.agent, {
      threadId: turn.threadId, paginationOpts: { numItems: 9, cursor: null },
    });
    return {
      repository: app ? app.githubOwner + "/" + app.githubRepoName : undefined,
      history: page.filter(entry => entry.id !== turn.assistantMessageId)
        .map(entry => ({ role: entry.role, text: entry.text.slice(entry.id === turn.messageId ? -32_000 : -3_000) })).reverse(),
    };
  },
});

export const authorize = mutation({
  args: { ...turnArgs, tokenHash: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { tokenHash, ...ref }) => {
    const turn = await active(ctx, ref);
    if (!turn || turn.cancelled || turn.deadline <= Date.now()) return false;
    await ctx.db.patch("users", ref.userId, { agentTurn: { ...turn, tokenHash } });
    return true;
  },
});

export const update = mutation({
  args: { ...turnArgs, prompt: v.optional(boatPrompt), cursor: v.optional(v.string()),
    text: v.optional(v.string()), finishedAt: v.optional(v.number()), delay: v.number(), finish: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { prompt, cursor, text, finishedAt, delay, finish, ...ref }) => {
    const current = await active(ctx, ref);
    if (!current) return null;
    const turn = { ...current };
    if (cursor) turn.cursor = cursor;
    if (prompt) turn.prompt = prompt;
    if (finishedAt) turn.finishedAt = finishedAt;
    let delta = (text ?? "").slice(0, Math.max(0, 128_000 - turn.size));
    if (finish && !turn.size && !delta) delta = "The coding agent finished without a text response.";
    const parts = [];
    if (delta) parts.push({ type: "text-delta", id: textId, delta: (turn.size ? "\n\n" : "") + delta });
    if (finish) parts.push({ type: "text-end", id: textId }, { type: "finish" });
    if (parts.length) {
      const end = turn.parts + parts.length;
      await ctx.runMutation(components.agent.streams.addDelta, { streamId: turn.streamId, start: turn.parts, end, parts });
      turn.parts = end;
      turn.size += delta.length;
    }
    if (finish) {
      await ctx.runMutation(components.agent.messages.finalizeMessage, {
        messageId: turn.assistantMessageId, result: { status: "success" },
      });
      await ctx.runMutation(components.agent.streams.finish, { streamId: turn.streamId });
      await ctx.db.patch("users", ref.userId, { agentTurn: undefined });
    } else {
      if (parts.length || turn.prompt !== current.prompt || turn.cursor !== current.cursor || turn.finishedAt !== current.finishedAt) {
        await ctx.db.patch("users", ref.userId, { agentTurn: turn });
      }
      await ctx.runMutation(components.agent.streams.heartbeat, { streamId: turn.streamId });
      await ctx.scheduler.runAfter(delay, internal.agent.actions.run.processTurn, ref);
    }
    return null;
  },
});

export const getSandboxSession = query({
  args: { tokenHash: v.string(), now: v.number() },
  returns: v.union(v.null(), v.object({ ...identity, messageId: v.string(), appSlug: v.optional(v.string()), threadId: v.string() })),
  handler: async (ctx, { tokenHash, now }) => {
    const user = await ctx.db.query("users").withIndex("by_agentTurn_tokenHash", q => q.eq("agentTurn.tokenHash", tokenHash)).unique();
    const turn = user?.agentTurn;
    if (!user || !turn || turn.cancelled || turn.deadline <= now) return null;
    return { userId: user._id, messageId: turn.messageId, appSlug: turn.appSlug, threadId: turn.threadId };
  },
});

export const linkApp = mutation({
  args: { ...identity, appSlug: v.string(), threadId: v.string() },
  handler: async (ctx, { userId, appSlug, threadId }) => {
    const app = await ownedApp(ctx, userId, appSlug);
    if (app && !app.agentThreadId) await ctx.db.patch("apps", app._id, { agentThreadId: threadId });
  },
});

export const claimApp = mutation({
  args: { ...turnArgs, appSlug: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { appSlug, ...ref }) => {
    const turn = await active(ctx, ref);
    if (!turn || turn.cancelled || turn.deadline <= Date.now()) return false;
    if (turn.appSlug) return turn.appSlug === appSlug;
    if (appSlug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appSlug)) return false;
    await ctx.db.patch("users", ref.userId, { agentTurn: { ...turn, appSlug } });
    return true;
  },
});

export const getAppConnection = query({
  args: { ...identity, appSlug: v.string() },
  handler: async (ctx, { userId, appSlug }) => ({
    app: await requireOwnedApp(ctx, userId, appSlug),
    connection: await findConnection(ctx, userId),
  }),
});
