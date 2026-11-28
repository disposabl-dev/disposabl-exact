"use node";

import { createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { siteOrigin } from "../../../../disposabl-kit/server/authSettings";
import { internal } from "../../_generated/api";
import { internalAction, type ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { turnArgs } from "../validators";
import { BoatError, eventCursor, events, findSandbox, interrupt, promptStatus, readySandbox, runPrompt } from "./boat";
import { clearWorkspace, installWorkspace } from "./workspace";

const state = internal.agent.internal;
type TurnRef = { userId: Id<"users">; messageId: string };

async function finish(ctx: ActionCtx, ref: TurnRef, sandboxId?: string, text?: string, cursor?: string) {
  await ctx.runMutation(state.update, { ...ref, cursor, text, delay: 0, finish: true });
  if (sandboxId) await clearWorkspace(sandboxId, ref.messageId).catch(() => {});
  return null;
}

export const processTurn = internalAction({
  args: turnArgs,
  returns: v.null(),
  handler: async (ctx, ref): Promise<null> => {
    const turn = await ctx.runQuery(state.getTurn, ref);
    if (!turn || turn.deadline <= Date.now()) return null;
    let sandboxId: string | undefined;
    try {
      if (turn.prompt || turn.cancelled) sandboxId = (await findSandbox(ref.userId))?.id;
      if (turn.cancelled) {
        if (sandboxId && turn.prompt) await interrupt(sandboxId, turn.prompt.conversationId);
        return await finish(ctx, ref, sandboxId, "Stopped by user.");
      }
      if (!turn.prompt) {
        const conversation = await ctx.runQuery(state.getConversation, ref);
        if (!conversation) return null;
        sandboxId = await readySandbox(ref.userId, ref.messageId);
        const token = "dsp_sandbox_" + randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        if (!await ctx.runMutation(state.authorize, { ...ref, tokenHash })) {
          return await finish(ctx, ref, sandboxId, "Stopped by user.");
        }
        const { repository, history } = conversation;
        const { directory, branch } = await installWorkspace(sandboxId, { origin: siteOrigin(), token, expiresAt: turn.deadline, turnId: ref.messageId }, turn.threadId, turn.appSlug, repository);
        const current = await ctx.runQuery(state.getTurn, ref);
        if (!current || current.cancelled) return await finish(ctx, ref, sandboxId, "Stopped by user.");
        const prompt = await runPrompt(sandboxId, `Work in ${directory}. ${repository ? `The repository ${repository} is linked.` :
          "To create an app, run bunx create-disposabl-app@latest with its name and stdin redirected from /dev/null. Use --resume if the directory exists. If setup prints a provider connection URL, give that URL to the user and ask them to continue after connecting."}
Export PATH="$HOME/.local/bin:$PATH" before running commands. Use Git and gh with this app's credentials. Checkpoint changes on ${branch}. Push to main only when the user requests a production release. Use disposabl-preview from packages/backend for a hosted preview. Keep credentials private.
Conversation ending with the latest user message:
${JSON.stringify(history)}`);
        await ctx.runMutation(state.update, { ...ref, prompt: { promptId: prompt.promptId, conversationId: prompt.conversationId }, delay: 0 });
        return null;
      }

      if (!sandboxId) return await finish(ctx, ref, undefined, "The coding sandbox is no longer available.");
      const result = await promptStatus(sandboxId, turn.prompt.promptId);
      const page = await events(sandboxId, turn.prompt.conversationId, turn.cursor);
      const last = page.events.at(-1);
      const cursor = page.pageInfo?.nextCursor ?? (last ? eventCursor(last) : turn.cursor);
      const text = page.events.flatMap(event => event.type === "response" && typeof event.data?.content === "string"
        ? [event.data.content] : []).join("\n\n");
      // Boat can publish the response after reporting the prompt as finished.
      const finishedAt = result.done ? turn.finishedAt ?? Date.now() : undefined;
      const hasResponse = turn.size > 0 || text.length > 0;
      if (finishedAt && !page.pageInfo?.hasMore && (hasResponse || result.status !== "finished" || Date.now() - finishedAt >= 30_000)) {
        const note = result.status === "failed" ? "The coding agent reported an error." : "";
        return await finish(ctx, ref, sandboxId, [text, note].filter(Boolean).join("\n\n"), cursor);
      }
      await ctx.runMutation(state.update, { ...ref, cursor, text, finishedAt, delay: page.pageInfo?.hasMore ? 0 : 1_000 });
      return null;
    } catch (error) {
      if (turn.prompt) {
        await ctx.runMutation(state.update, { ...ref, delay: 3_000 });
        return null;
      }
      const code = error instanceof BoatError ? error.code : undefined;
      return await finish(ctx, ref, sandboxId, code === "unsafe_environment" ? "The sandbox needs a Boat environment with proxied AI access."
        : code === "provider_not_configured" || code === "ultrafast_not_supported" ? "Codex Ultrafast is unavailable in Boat."
        : "The coding agent could not start. Send another message to try again.");
    }
  },
});

export const expire = internalAction({
  args: turnArgs,
  returns: v.null(),
  handler: async (ctx, ref): Promise<null> => {
    const turn = await ctx.runQuery(state.getTurn, ref);
    if (!turn) return null;
    const sandboxId = (await findSandbox(ref.userId).catch(() => undefined))?.id;
    if (sandboxId && turn.prompt) await interrupt(sandboxId, turn.prompt.conversationId).catch(() => {});
    return await finish(ctx, ref, sandboxId, turn.cancelled ? "Stopped by user." : "The coding agent timed out.");
  },
});
