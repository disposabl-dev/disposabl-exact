import { createThread, getThreadMetadata, listUIMessages, saveMessage, syncStreams } from "@convex-dev/agent";
import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation as mutation, internalQuery as query, type QueryCtx } from "../_generated/server";
import { ownedApp, requireOwnedApp } from "../apps/internal";
import type { appRef } from "../apps/validators";
import { findConnection } from "../connections/internal";
import { abortArgs, abortResult, boatPrompt, messagesArgs, messagesResult, sendArgs, sendResult, turnArgs } from "./validators";

const identity = { userId: v.id("users") };
const turnLifetime = 30 * 60_000;
const textId = "assistant";

function workspace(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db.query("agentSandboxes").withIndex("by_userId", q => q.eq("userId", userId)).unique();
}

async function conversation(ctx: QueryCtx, userId: Id<"users">, ref: Infer<typeof appRef>, suppliedThread?: string) {
  const app = ref.appSlug !== undefined || ref.appId !== undefined ? await requireOwnedApp(ctx, userId, ref) : null;
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
  handler: async (ctx, { userId, threadId: suppliedThread, prompt, ...ref }) => {
    const text = prompt.trim();
    if (!text || text.length > 32_000) throw new ConvexError("Message must be 1–32,000 characters.");
    const box = await workspace(ctx, userId);
    if (box?.turn) throw new ConvexError("Wait for the current message or stop it before sending another.");

    const target = await conversation(ctx, userId, ref, suppliedThread);
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
    const sandbox = box?._id ?? await ctx.db.insert("agentSandboxes", { userId });
    await ctx.db.patch("agentSandboxes", sandbox, { turn });
    const run = internal.agent.actions.run.processTurn;
    await ctx.scheduler.runAfter(0, run, { sandbox, messageId });
    await ctx.scheduler.runAfter(turnLifetime, internal.agent.actions.run.expire, { sandbox, messageId });
    return { threadId, messageId, assistantMessageId };
  },
});

export const getMessages = internalQuery({
  platforms: true,
  description: "Read conversation messages and stream deltas by app slug or thread ID.",
  args: { ...identity, ...messagesArgs },
  returns: messagesResult,
  handler: async (ctx, { userId, threadId: suppliedThread, paginationOpts, streamArgs, ...ref }) => {
    const { threadId } = await conversation(ctx, userId, ref, suppliedThread);
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
  handler: async (ctx, { userId, threadId: suppliedThread, messageId, ...ref }) => {
    const { threadId } = await conversation(ctx, userId, ref, suppliedThread);
    const box = await workspace(ctx, userId);
    if (!box?.turn || box.turn.threadId !== threadId || box.turn.messageId !== messageId) return { accepted: false };
    await ctx.db.patch("agentSandboxes", box._id, { turn: { ...box.turn, cancelled: true, tokenHash: undefined } });
    return { accepted: true };
  },
});

async function active(ctx: QueryCtx, { sandbox, messageId }: { sandbox: Id<"agentSandboxes">; messageId: string }) {
  const box = await ctx.db.get("agentSandboxes", sandbox);
  return box?.turn?.messageId === messageId ? { ...box, turn: box.turn } : null;
}

export const getTurn = query({ args: turnArgs, handler: active });

export const getConversation = query({
  args: turnArgs,
  handler: async (ctx, args) => {
    const box = await active(ctx, args);
    if (!box) return null;
    const { userId, turn } = box;
    const app = turn.appSlug && await ownedApp(ctx, userId, { appSlug: turn.appSlug });
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
  args: { ...turnArgs, sandboxId: v.string(), tokenHash: v.string() },
  handler: async (ctx, { sandboxId, tokenHash, ...ref }) => {
    const box = await active(ctx, ref);
    if (!box || box.turn.cancelled) return false;
    await ctx.db.patch("agentSandboxes", ref.sandbox, { sandboxId, turn: { ...box.turn, tokenHash } });
    return true;
  },
});

export const update = mutation({
  args: { ...turnArgs, prompt: v.optional(boatPrompt), cursor: v.optional(v.string()),
    text: v.optional(v.string()), finishedAt: v.optional(v.number()), delay: v.number(), finish: v.optional(v.boolean()) },
  handler: async (ctx, { prompt, cursor, text, finishedAt, delay, finish, ...ref }) => {
    const box = await active(ctx, ref);
    if (!box) return;
    const turn = { ...box.turn };
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
      await ctx.db.patch("agentSandboxes", ref.sandbox, { turn: undefined });
    } else {
      await ctx.db.patch("agentSandboxes", ref.sandbox, { turn });
      await ctx.runMutation(components.agent.streams.heartbeat, { streamId: turn.streamId });
      await ctx.scheduler.runAfter(delay, internal.agent.actions.run.processTurn, ref);
    }
  },
});

export const getSandboxSession = query({
  args: { tokenHash: v.string(), now: v.number() },
  handler: async (ctx, { tokenHash, now }) => {
    const box = await ctx.db.query("agentSandboxes").withIndex("by_tokenHash", q => q.eq("turn.tokenHash", tokenHash)).unique();
    const turn = box?.turn;
    if (!turn || turn.cancelled || turn.deadline <= now) return null;
    return { sandbox: box._id, userId: box.userId, messageId: turn.messageId, appSlug: turn.appSlug, threadId: turn.threadId };
  },
});

export const linkApp = mutation({
  args: { ...identity, appSlug: v.string(), threadId: v.string() },
  handler: async (ctx, { userId, appSlug, threadId }) => {
    const app = await ownedApp(ctx, userId, { appSlug });
    if (app && !app.agentThreadId) await ctx.db.patch("apps", app._id, { agentThreadId: threadId });
  },
});

export const claimApp = mutation({
  args: { ...turnArgs, appSlug: v.string() },
  handler: async (ctx, { appSlug, ...ref }) => {
    const box = await active(ctx, ref);
    if (!box || box.turn.cancelled || box.turn.deadline <= Date.now()) return false;
    if (box.turn.appSlug) return box.turn.appSlug === appSlug;
    if (appSlug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appSlug)) return false;
    await ctx.db.patch("agentSandboxes", ref.sandbox, { turn: { ...box.turn, appSlug } });
    return true;
  },
});

export const getAppConnection = query({
  args: { ...identity, appSlug: v.string() },
  handler: async (ctx, { userId, appSlug }) => ({
    app: await requireOwnedApp(ctx, userId, { appSlug }),
    connection: await findConnection(ctx, userId),
  }),
});
