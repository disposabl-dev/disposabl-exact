import { createThread, getThreadMetadata, listUIMessages, saveMessage, saveMessages, syncStreams } from "@convex-dev/agent";
import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation as mutation, internalQuery as query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { ownedApp, requireOwnedApp } from "../apps/internal";
import { abortArgs, abortResult, messagesArgs, messagesResult, sendArgs, sendResult, turnArgs } from "./validators";

const identity = { userId: v.id("users") };
const textId = "assistant";
const maxResponseLength = 128_000;
const turnLifetime = 30 * 60_000;

function sandboxForUser(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("agentSandboxes").withIndex("by_userId", q => q.eq("userId", userId)).unique();
}

async function conversation(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  { appSlug, threadId }: { appSlug?: string; threadId?: string },
) {
  const app = appSlug ? await requireOwnedApp(ctx, userId, appSlug) : null;
  if (threadId) {
    const thread = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
    if (thread?.userId !== userId || (app && app.agentThreadId !== threadId)) {
      throw new ConvexError("Conversation not found.");
    }
  }
  return { app, threadId: threadId ?? app?.agentThreadId };
}

export const sendMessage = internalMutation({
  platforms: true,
  description: "Send a message to the coding agent. Omit appSlug and threadId to start a conversation.",
  args: { ...identity, ...sendArgs },
  returns: sendResult,
  handler: async (ctx, { userId, appSlug, threadId: providedThread, prompt }): Promise<Infer<typeof sendResult>> => {
    const text = prompt.trim();
    if (!text || text.length > 32_000) throw new ConvexError("Message must be 1–32,000 characters.");

    const sandbox = await sandboxForUser(ctx, userId);
    if (sandbox?.activeTurnId) {
      const active = await ctx.db.get("agentTurns", sandbox.activeTurnId);
      if (active && !active.done) throw new ConvexError("Wait for the current message or stop it before sending another.");
    }
    const target = await conversation(ctx, userId, { appSlug, threadId: providedThread });
    const threadId = target.threadId ?? await createThread(ctx, components.agent, { userId, title: target.app?.name });
    const lastTurn = target.threadId ? await ctx.db.query("agentTurns")
      .withIndex("by_threadId", q => q.eq("threadId", threadId)).order("desc").first() : null;
    const targetSlug = target.app?.slug ?? lastTurn?.appSlug;
    if (target.app && !target.app.agentThreadId) await ctx.db.patch("apps", target.app._id, { agentThreadId: threadId });

    const { messageId, message } = await saveMessage(ctx, components.agent, { threadId, userId, prompt: text });
    const { messageId: assistantMessageId, message: assistant } = await saveMessage(ctx, components.agent, {
      threadId, userId, promptMessageId: messageId,
      message: { role: "assistant", content: "" },
      metadata: { status: "pending" },
    });
    const streamId = await ctx.runMutation(components.agent.streams.create, {
      threadId, userId, order: message.order, stepOrder: assistant.stepOrder,
      agentName: "Codex", provider: "openai", format: "UIMessageChunk",
    });
    await ctx.runMutation(components.agent.streams.addDelta, {
      streamId, start: 0, end: 2, parts: [{ type: "start", messageId: assistantMessageId }, { type: "text-start", id: textId }],
    });
    const turnId = await ctx.db.insert("agentTurns", {
      userId, threadId, ...(targetSlug ? { appSlug: targetSlug } : {}), messageId, assistantMessageId, streamId,
      text: "", parts: 2, deadline: Date.now() + turnLifetime, done: false,
      ...(lastTurn?.sandboxId === sandbox?.sandboxId && lastTurn?.conversationId ? { conversationId: lastTurn.conversationId } : {}),
    });
    if (sandbox) await ctx.db.patch("agentSandboxes", sandbox._id, { activeTurnId: turnId });
    else await ctx.db.insert("agentSandboxes", { userId, activeTurnId: turnId });
    await ctx.scheduler.runAfter(0, internal.agent.actions.run.start, { turnId });
    await ctx.scheduler.runAfter(turnLifetime, internal.agent.actions.run.expire, { turnId });
    return { threadId, messageId, assistantMessageId };
  },
});

export const getMessages = internalQuery({
  platforms: true,
  description: "Read conversation messages and stream deltas by app slug or thread ID.",
  args: { ...identity, ...messagesArgs },
  returns: messagesResult,
  handler: async (ctx, { userId, appSlug, threadId: providedThread, paginationOpts, streamArgs }) => {
    const { threadId } = await conversation(ctx, userId, { appSlug, threadId: providedThread });
    if (!threadId) return { page: [], isDone: true, continueCursor: "" };
    const page = await listUIMessages(ctx, components.agent, { threadId, paginationOpts });
    const streams = await syncStreams(ctx, components.agent, { threadId, streamArgs });
    return { ...page, streams };
  },
});

export const abortMessage = internalMutation({
  platforms: true,
  description: "Stop the active coding agent turn.",
  args: { ...identity, ...abortArgs },
  returns: abortResult,
  handler: async (ctx, { userId, appSlug, threadId: providedThread, messageId }) => {
    const { threadId } = await conversation(ctx, userId, { appSlug, threadId: providedThread });
    const sandbox = await sandboxForUser(ctx, userId);
    const turn = sandbox?.activeTurnId && await ctx.db.get("agentTurns", sandbox.activeTurnId);
    if (!turn || turn.done || !threadId || turn.threadId !== threadId || turn.messageId !== messageId) return { accepted: false };
    await ctx.db.patch("agentTurns", turn._id, { cancelled: true, tokenHash: undefined });
    return { accepted: true };
  },
});

export const getTurn = query({
  args: turnArgs,
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    if (!turn || turn.done) return null;
    const sandbox = await sandboxForUser(ctx, turn.userId);
    const [message] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [turn.messageId] });
    const app = turn.appSlug && await ownedApp(ctx, turn.userId, turn.appSlug);
    const history = await listUIMessages(ctx, components.agent, {
      threadId: turn.threadId, paginationOpts: { numItems: 9, cursor: null },
    });
    return {
      turn, existingSandboxId: sandbox?.sandboxId, prompt: message?.text,
      repository: app ? app.githubOwner + "/" + app.githubRepoName : undefined,
      history: history.page.filter(entry => entry.id !== turn.messageId && entry.id !== turn.assistantMessageId)
        .map(({ role, text }) => ({ role, text: text.slice(-3_000) })).reverse(),
    };
  },
});

export const getActiveTurn = query({
  args: turnArgs,
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    return turn && !turn.done ? turn : null;
  },
});

export const sandboxReady = mutation({
  args: { ...turnArgs, sandboxId: v.string(), tokenHash: v.string() },
  handler: async (ctx, { turnId, sandboxId, tokenHash }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    if (!turn || turn.done || turn.cancelled) return false;
    const sandbox = await sandboxForUser(ctx, turn.userId);
    if (!sandbox || sandbox.activeTurnId !== turnId) return false;
    await ctx.db.patch("agentSandboxes", sandbox._id, { sandboxId });
    await ctx.db.patch("agentTurns", turnId, { sandboxId, tokenHash });
    return true;
  },
});

export const promptStarted = mutation({
  args: { ...turnArgs, promptId: v.string(), conversationId: v.string(), cursor: v.optional(v.string()) },
  handler: async (ctx, { turnId, ...prompt }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    if (!turn || turn.done) return;
    await ctx.db.patch("agentTurns", turnId, prompt);
    await ctx.scheduler.runAfter(0, internal.agent.actions.run.poll, { turnId });
  },
});

async function appendText(ctx: MutationCtx, turn: Doc<"agentTurns">, text: string) {
  const delta = text.slice(0, maxResponseLength - turn.text.length);
  if (!delta) {
    await ctx.runMutation(components.agent.streams.heartbeat, { streamId: turn.streamId });
    return;
  }
  await ctx.runMutation(components.agent.streams.addDelta, {
    streamId: turn.streamId, start: turn.parts, end: turn.parts + 1,
    parts: [{ type: "text-delta", id: textId, delta }],
  });
  await ctx.db.patch("agentTurns", turn._id, { text: turn.text + delta, parts: turn.parts + 1 });
}

export const advance = mutation({
  args: { ...turnArgs, cursor: v.optional(v.string()), text: v.string(), delay: v.number() },
  handler: async (ctx, { turnId, cursor, text, delay }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    if (!turn || turn.done) return;
    await appendText(ctx, turn, text);
    if (cursor) await ctx.db.patch("agentTurns", turnId, { cursor });
    await ctx.scheduler.runAfter(delay, internal.agent.actions.run.poll, { turnId });
  },
});

export const finish = mutation({
  args: { ...turnArgs, text: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { turnId, text, note }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    if (!turn || turn.done) return;
    const output = (turn.text + text).slice(0, maxResponseLength);
    const content = [output, note].filter(Boolean).join("\n\n") || "The coding agent finished without a text response.";
    const [pending] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [turn.assistantMessageId] });
    if (pending?.status === "pending") {
      await saveMessages(ctx, components.agent, {
        threadId: turn.threadId, userId: turn.userId, pendingMessageId: turn.assistantMessageId,
        messages: [{ role: "assistant", content }],
      });
      await ctx.runMutation(components.agent.streams.finish, { streamId: turn.streamId });
    }
    await ctx.db.patch("agentTurns", turnId, { done: true, tokenHash: undefined, text: "" });
    const sandbox = await sandboxForUser(ctx, turn.userId);
    if (sandbox?.activeTurnId === turnId) await ctx.db.patch("agentSandboxes", sandbox._id, { activeTurnId: undefined });
  },
});

export const getSandboxSession = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const turn = await ctx.db.query("agentTurns").withIndex("by_tokenHash", q => q.eq("tokenHash", tokenHash)).unique();
    if (!turn || turn.done || turn.cancelled || turn.deadline < Date.now()) return null;
    return { turnId: turn._id, userId: turn.userId, appSlug: turn.appSlug, threadId: turn.threadId };
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
  handler: async (ctx, { turnId, appSlug }) => {
    const turn = await ctx.db.get("agentTurns", turnId);
    if (!turn || turn.done || turn.cancelled || turn.deadline < Date.now()) return false;
    if (turn.appSlug) return turn.appSlug === appSlug;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appSlug) || appSlug.length > 63) return false;
    await ctx.db.patch("agentTurns", turnId, { appSlug });
    return true;
  },
});

export const getAppConnection = query({
  args: { ...identity, appSlug: v.string() },
  handler: async (ctx, { userId, appSlug }) => ({
    app: await requireOwnedApp(ctx, userId, appSlug),
    connection: await ctx.db.query("connections").withIndex("by_userId", q => q.eq("userId", userId)).unique(),
  }),
});
