import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { app, appSlugArgs, appOrNull, appPage, createArgs, listArgs, removeArgs } from "./validators";

const identity = { userId: v.id("users") };

function presentApp(row: Doc<"apps">): Infer<typeof app> {
  const { _id, userId: _userId, agentThreadId: _agentThreadId, name, slug, ...fields } = row;
  return { ...fields, appName: name, appSlug: slug };
}

async function ownedApp(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, appSlug: string) {
  const row = await ctx.db.query("apps").withIndex("by_slug", q => q.eq("slug", appSlug)).unique();
  return row?.userId === userId ? row : null;
}

export async function requireOwnedApp(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, appSlug: string) {
  const row = await ownedApp(ctx, userId, appSlug);
  if (!row) throw new ConvexError("App not found.");
  return row;
}

export const list = internalQuery({
  platforms: true,
  description: "List your apps.",
  args: { ...identity, ...listArgs },
  returns: appPage,
  handler: async (ctx, { userId, paginationOpts }) => {
    const page = await ctx.db.query("apps")
      .withIndex("by_userId", q => q.eq("userId", userId))
      .order("desc")
      .paginate(paginationOpts);
    return { ...page, page: page.page.map(presentApp) };
  },
});

export const get = internalQuery({
  platforms: true,
  description: "Get an app and its saved platform results.",
  args: { ...identity, ...appSlugArgs },
  returns: appOrNull,
  handler: async (ctx, { userId, appSlug }) => {
    const row = await ownedApp(ctx, userId, appSlug);
    return row ? presentApp(row) : null;
  },
});

export const create = internalMutation({
  platforms: true,
  description: "Register an app with existing GitHub and Convex resource identifiers.",
  args: { ...identity, ...createArgs },
  returns: app,
  handler: async (ctx, args) => {
    const { userId, convexProjectId } = args;
    const name = args.appName.trim();
    const slug = args.appSlug.trim().toLowerCase();
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
        return presentApp(existing);
      }
      throw new ConvexError("App slug is already in use.");
    }

    const id = await ctx.db.insert("apps", {
      userId, name, slug, githubOwner, githubRepoName, convexProjectId, prod: null, live: null,
    });
    const row = await ctx.db.get("apps", id);
    if (!row) throw new ConvexError("App could not be saved.");
    return presentApp(row);
  },
});

export const remove = internalMutation({
  platforms: true,
  description: "Delete an app's records and conversation if it has no live data.",
  args: { ...identity, ...removeArgs },
  returns: v.null(),
  handler: async (ctx, { userId, appSlug }): Promise<null> => {
    const row = await ownedApp(ctx, userId, appSlug);
    if (!row) return null;
    if (row.live !== null) throw new ConvexError("An app with live data cannot be deleted.");

    if (row.agentThreadId) {
      await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: row.agentThreadId });
    }
    await ctx.scheduler.runAfter(0, internal.previews.internal.removeForApp, { appDocumentId: row._id });
    await ctx.db.delete("apps", row._id);
    return null;
  },
});
