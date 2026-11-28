import { internalQuery } from "@disposabl-kit/server";
import { ConvexError, v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { connectionsStatus, convexAccount, flowArgs, githubAccount, user, type Provider } from "./validators";

const flowFields = { github: "githubFlow", convex: "convexFlow" } as const;

export function findConnection(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("connections").withIndex("by_userId", q => q.eq("userId", userId)).unique();
}

export async function readStatus(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<Infer<typeof connectionsStatus>> {
  const row = await findConnection(ctx, userId);
  return {
    github: row?.github ? { connected: true, owner: row.github.owner } : { connected: false },
    convex: row?.convex ? { connected: true, teamId: row.convex.teamId } : { connected: false },
  };
}

export const status = internalQuery({
  platforms: true,
  description: "Get GitHub and Convex connection status.",
  args: user,
  returns: connectionsStatus,
  handler: (ctx, { userId }) => readStatus(ctx, userId),
});

export const begin = internalMutation({
  args: { ...user, ...flowArgs, verifier: v.string(), previousStateHash: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { userId, provider, stateHash, verifier, previousStateHash }) => {
    const row = await findConnection(ctx, userId);
    if (previousStateHash && row?.[flowFields[provider]]?.stateHash !== previousStateHash) {
      throw new ConvexError("This connection link expired. Start again.");
    }
    const patch = { [flowFields[provider]]: { stateHash, verifier, expiresAt: Date.now() + 10 * 60_000 } };
    if (row) await ctx.db.patch("connections", row._id, patch);
    else await ctx.db.insert("connections", { userId, ...patch });
    return null;
  },
});

async function currentFlow(ctx: MutationCtx, { provider, stateHash }: { provider: Provider; stateHash: string }) {
  const row = provider === "github"
    ? await ctx.db.query("connections").withIndex("by_github_state", q => q.eq("githubFlow.stateHash", stateHash)).unique()
    : await ctx.db.query("connections").withIndex("by_convex_state", q => q.eq("convexFlow.stateHash", stateHash)).unique();
  const flow = row?.[flowFields[provider]];
  if (!row || !flow || flow.expiresAt <= Date.now()) {
    throw new ConvexError("This connection link expired. Start again.");
  }
  return { row, flow };
}

export const consume = internalMutation({
  args: flowArgs,
  returns: v.object({ userId: v.id("users"), verifier: v.string() }),
  handler: async (ctx, args) => {
    const { row, flow: { verifier, ...flow } } = await currentFlow(ctx, args);
    if (!verifier) throw new ConvexError("This connection link was already used.");
    await ctx.db.patch("connections", row._id, { [flowFields[args.provider]]: flow });
    return { userId: row.userId, verifier };
  },
});

export const finishGithub = internalMutation({
  args: { stateHash: v.string(), accounts: v.array(githubAccount) },
  returns: v.null(),
  handler: async (ctx, { stateHash, accounts }) => {
    const { row, flow } = await currentFlow(ctx, { provider: "github", stateHash });
    if (accounts.length === 1) {
      await ctx.db.patch("connections", row._id, { github: accounts[0], githubFlow: undefined });
    } else {
      await ctx.db.patch("connections", row._id, { githubFlow: { ...flow, githubAccounts: accounts } });
    }
    return null;
  },
});

export const selectGithub = internalMutation({
  args: { stateHash: v.string(), installationId: v.string() },
  returns: v.null(),
  handler: async (ctx, { stateHash, installationId }) => {
    const { row, flow } = await currentFlow(ctx, { provider: "github", stateHash });
    const github = flow.githubAccounts?.find(account => account.installationId === installationId);
    if (!github) throw new ConvexError("Choose one of the verified GitHub accounts.");
    await ctx.db.patch("connections", row._id, { github, githubFlow: undefined });
    return null;
  },
});

export const finishConvex = internalMutation({
  args: { stateHash: v.string(), account: convexAccount },
  returns: v.null(),
  handler: async (ctx, { stateHash, account }) => {
    const { row } = await currentFlow(ctx, { provider: "convex", stateHash });
    await ctx.db.patch("connections", row._id, { convex: account, convexFlow: undefined });
    return null;
  },
});

export async function disconnectProvider(ctx: MutationCtx, userId: Id<"users">, provider: Provider) {
  const row = await findConnection(ctx, userId);
  if (row) await ctx.db.patch("connections", row._id, { [provider]: undefined, [flowFields[provider]]: undefined });
  return null;
}
