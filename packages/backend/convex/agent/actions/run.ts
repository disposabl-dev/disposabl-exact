"use node";

import { createHash, randomBytes } from "node:crypto";
import { siteOrigin } from "../../../../disposabl-kit/server/authSettings";
import { internal } from "../../_generated/api";
import { internalAction, type ActionCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { turnArgs } from "../validators";
import { BoatError, eventCursor, events, interrupt, promptStatus, readySandbox, runPrompt } from "./boat";
import { clearWorkspace, installWorkspace } from "./workspace";

const state = internal.agent.internal;

function instruction(directory: string, branch: string, repository?: string) {
  return `You are the coding agent for this user's Disposabl workspace. Work in ${directory}.
${repository ? `The repository ${repository} is already linked.` : `If the user asks you to create an app, run bunx create-disposabl-app@latest with their app name and redirect stdin from /dev/null. Use --resume with an existing scaffold. Keep the scaffold under ${directory}. The Disposabl CLI is signed in for this turn. If setup prints a GitHub or Convex connection URL, give the full URL to the user in your assistant response and ask them to open it and continue this conversation when connected. Do not invent a URL or ask for a token. Creation stops until both accounts are connected.`}
Export PATH="$HOME/.local/bin:$PATH" for gh and disposabl-preview. Git over HTTPS and gh can access this app's repository after it is linked. Run disposabl-preview from packages/backend if a hosted Convex preview is needed. Use branch ${branch} to checkpoint completed work for later turns. Do not push to main unless the user asks. Keep secrets out of your response, repository, and command output.`;
}

function failure(error: unknown) {
  if (error instanceof BoatError) {
    if (error.code === "unsafe_environment") return "The sandbox needs a Boat environment with proxied AI access.";
    if (error.code === "provider_not_configured" || error.code === "ultrafast_not_supported") {
      return "Codex Ultrafast is unavailable for this workspace. Ask your administrator to check the Boat model settings.";
    }
    if (error.status === 429) return "The sandbox provider is busy. Send the message again in a moment.";
  }
  return "The coding agent could not complete this turn. Send another message to try again.";
}

async function finish(ctx: ActionCtx, turn: Doc<"agentTurns">, text = "", note?: string) {
  await ctx.runMutation(state.finish, { turnId: turn._id, text, note });
  if (turn.sandboxId) await clearWorkspace(turn.sandboxId, turn._id).catch(() => {});
}

function lastCursor(page: Awaited<ReturnType<typeof events>>, fallback?: string) {
  const last = page.events.at(-1);
  return page.pageInfo?.nextCursor ?? (last ? eventCursor(last) : fallback);
}

export const start = internalAction({
  args: turnArgs,
  handler: async (ctx, { turnId }): Promise<void> => {
    const data = await ctx.runQuery(state.getTurn, { turnId });
    if (!data) return;
    const { turn, existingSandboxId, prompt, repository, history } = data;
    let sandboxId: string | undefined;
    try {
      if (turn.cancelled) return await finish(ctx, turn, "", "Stopped by user.");
      sandboxId = await readySandbox(existingSandboxId, turnId);
      const id = sandboxId;
      const token = "dsp_sandbox_" + randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      if (!await ctx.runMutation(state.sandboxReady, { turnId, sandboxId: id, tokenHash })) {
        await finish(ctx, turn, "", "Stopped by user.");
        return;
      }
      const { directory, branch } = await installWorkspace(id, { origin: siteOrigin(), token, expiresAt: turn.deadline, turnId }, turn.threadId, turn.appSlug, repository);
      const current = await ctx.runQuery(state.getActiveTurn, { turnId });
      if (!current || current.cancelled) return await finish(ctx, { ...turn, sandboxId: id }, "", "Stopped by user.");

      const conversationId = id === existingSandboxId ? turn.conversationId : undefined;
      const cursor = conversationId ? lastCursor(await events(id, conversationId, undefined, true)) : undefined;
      if (!prompt) throw new Error("Message could not be loaded.");
      const context = !conversationId && history.length ? `\nConversation history:\n${JSON.stringify(history)}\n` : "";
      const result = await runPrompt(id, `${instruction(directory, branch, repository)}${context}\n\nUser message:\n${prompt}`, conversationId);
      await ctx.runMutation(state.promptStarted, { turnId, promptId: result.promptId, conversationId: result.conversationId, cursor });
    } catch (error) {
      await finish(ctx, { ...turn, sandboxId }, "", failure(error));
    }
  },
});

export const poll = internalAction({
  args: turnArgs,
  handler: async (ctx, { turnId }): Promise<void> => {
    const turn = await ctx.runQuery(state.getActiveTurn, { turnId });
    if (!turn?.sandboxId || !turn.promptId || !turn.conversationId) return;
    try {
      if (turn.cancelled) await interrupt(turn.sandboxId, turn.conversationId);
      const prompt = await promptStatus(turn.sandboxId, turn.promptId);
      const page = await events(turn.sandboxId, turn.conversationId, turn.cursor);
      const text = page.events.flatMap(event => event.type === "response" && typeof event.data?.content === "string" && event.data.content
        ? [event.data.content] : []).join("\n\n");
      const delta = text && turn.text ? "\n\n" + text : text;
      if (prompt.done && !page.pageInfo?.hasMore) {
        const note = prompt.status === "interrupted" ? "Stopped by user."
          : prompt.status === "failed" ? "The coding agent reported an error. Send another message to try again." : undefined;
        await finish(ctx, turn, delta, note);
        return;
      }
      await ctx.runMutation(state.advance, { turnId, cursor: lastCursor(page, turn.cursor), text: delta, delay: page.pageInfo?.hasMore ? 0 : 1_000 });
    } catch {
      if (Date.now() < turn.deadline) {
        await ctx.runMutation(state.advance, { turnId, text: "", delay: 3_000 });
      }
    }
  },
});

export const expire = internalAction({
  args: turnArgs,
  handler: async (ctx, { turnId }): Promise<void> => {
    const turn = await ctx.runQuery(state.getActiveTurn, { turnId });
    if (!turn) return;
    if (turn.sandboxId && turn.conversationId && turn.promptId) {
      await interrupt(turn.sandboxId, turn.conversationId).catch(() => {});
    }
    await finish(ctx, turn, "", turn.cancelled ? "Stopped by user." : "The coding agent timed out. Send another message to continue.");
  },
});
