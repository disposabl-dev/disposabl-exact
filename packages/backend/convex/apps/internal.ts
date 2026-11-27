import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { app, appIdArgs, appOrNull, appPage, createArgs, listArgs, removeArgs } from "./validators";

const identity = { userId: v.id("users") };

export async function ownedApp(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, appId: Id<"apps">) {
  const row = await ctx.db.get("apps", appId);
  return row?.userId === userId ? row : null;
}

export async function requireOwnedApp(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, appId: Id<"apps">) {
  const row = await ownedApp(ctx, userId, appId);
  if (!row) throw new ConvexError("App not found.");
  return row;
}

export const list = internalQuery({
  platforms: true,
  description: "List your apps.",
  args: { ...identity, ...listArgs },
  returns: appPage,
  handler: (ctx, { userId, paginationOpts }) =>
    ctx.db.query("apps")
      .withIndex("by_userId", q => q.eq("userId", userId))
      .order("desc")
      .paginate(paginationOpts),
});

export const get = internalQuery({
  platforms: true,
  description: "Get an app and its saved platform results.",
  args: { ...identity, ...appIdArgs },
  returns: appOrNull,
  handler: (ctx, { userId, appId }) => ownedApp(ctx, userId, appId),
});

export const create = internalMutation({
  platforms: true,
  description: "Register an app with existing GitHub and Convex resource identifiers.",
  args: { ...identity, ...createArgs },
  returns: app,
  handler: async (ctx, args) => {
    const { userId, convexProjectId } = args;
    const name = args.name.trim();
    const slug = args.slug.trim().toLowerCase();
    const githubOwner = args.githubOwner.trim().toLowerCase();
    const githubRepoName = args.githubRepoName.trim().toLowerCase();
    if (!name || name.length > 100) throw new ConvexError("App name must be 1–100 characters.");
    if (slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new ConvexError("Use a slug of up to 63 letters, numbers, and single hyphens.");
    }
    if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(githubOwner)
      || !/^[a-z0-9_.-]{1,100}$/.test(githubRepoName)
      || githubRepoName === "." || githubRepoName === "..") {
      throw new ConvexError("Invalid GitHub repository.");
    }
    if (!Number.isSafeInteger(convexProjectId) || convexProjectId <= 0) {
      throw new ConvexError("Invalid Convex project ID.");
    }

    const existing = await ctx.db.query("apps").withIndex("by_slug", q => q.eq("slug", slug)).unique();
    if (existing) {
      if (existing.userId === userId && existing.name === name && existing.githubOwner === githubOwner
        && existing.githubRepoName === githubRepoName && existing.convexProjectId === convexProjectId) {
        return existing;
      }
      throw new ConvexError("App slug is already in use.");
    }

    const id = await ctx.db.insert("apps", {
      userId, name, slug, githubOwner, githubRepoName, convexProjectId, prod: null, live: null,
    });
    return await requireOwnedApp(ctx, userId, id);
  },
});

export const remove = internalMutation({
  platforms: true,
  description: "Delete an app's records and conversation if it has no live data.",
  args: { ...identity, ...removeArgs },
  returns: v.null(),
  handler: async (ctx, { userId, appId }): Promise<null> => {
    const row = await ownedApp(ctx, userId, appId);
    if (!row) return null;
    if (row.live !== null) throw new ConvexError("An app with live data cannot be deleted.");

    if (row.agentThreadId) {
      await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: row.agentThreadId });
    }
    await ctx.scheduler.runAfter(0, internal.previews.internal.removeForApp, { appId });
    await ctx.db.delete("apps", appId);
    return null;
  },
});
