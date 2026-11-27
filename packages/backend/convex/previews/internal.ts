import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { ownedApp, requireOwnedApp } from "../apps/internal";
import { appIdArgs } from "../apps/validators";
import { createArgs, getArgs, listArgs, preview, previewOrNull, previewPage, removeArgs } from "./validators";

const identity = { userId: v.id("users") };

function slugPart(value: string, maxLength: number) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, maxLength).replace(/^-|-$/g, "");
}

export const create = internalMutation({
  platforms: true,
  description: "Create or get a preview record for an app's Git ref.",
  args: { ...identity, ...createArgs },
  returns: preview,
  handler: async (ctx, { userId, appId, gitRef, name }) => {
    const app = await requireOwnedApp(ctx, userId, appId);
    const previewName = name?.trim() ?? gitRef;
    if (!gitRef || gitRef.length > 200
      || /\s/.test(gitRef) || [...gitRef].some(char => char <= " " || char.charCodeAt(0) === 127)) {
      throw new ConvexError("Provide a Git ref of up to 200 characters without whitespace.");
    }
    if (!previewName || previewName.length > 200) throw new ConvexError("Invalid preview name.");

    const existing = await ctx.db.query("previews")
      .withIndex("by_appId_and_gitRef", q => q.eq("appId", appId).eq("gitRef", gitRef))
      .unique();
    if (existing) return existing;

    const appSlug = slugPart(app.slug, 28) || "app";
    const refSlug = slugPart(gitRef, 24) || "preview";
    const suffix = crypto.randomUUID().slice(0, 8);
    const previewSlug = `${appSlug}--${refSlug}-${suffix}`;
    if (await ctx.db.query("previews").withIndex("by_previewSlug", q => q.eq("previewSlug", previewSlug)).unique()) {
      throw new ConvexError("Preview slug already exists. Retry creation.");
    }

    const id = await ctx.db.insert("previews", { appId, gitRef, previewName, previewSlug, platforms: {} });
    const row = await ctx.db.get("previews", id);
    if (!row) throw new ConvexError("Preview could not be saved.");
    return row;
  },
});

export const list = internalQuery({
  platforms: true,
  description: "List an app's previews.",
  args: { ...identity, ...listArgs },
  returns: previewPage,
  handler: async (ctx, { userId, appId, paginationOpts }) => {
    await requireOwnedApp(ctx, userId, appId);
    return ctx.db.query("previews")
      .withIndex("by_appId_and_gitRef", q => q.eq("appId", appId))
      .paginate(paginationOpts);
  },
});

export const get = internalQuery({
  platforms: true,
  description: "Get a preview by its slug.",
  args: { ...identity, ...getArgs },
  returns: previewOrNull,
  handler: async (ctx, { userId, previewSlug }) => {
    const row = await ctx.db.query("previews").withIndex("by_previewSlug", q => q.eq("previewSlug", previewSlug)).unique();
    return row && await ownedApp(ctx, userId, row.appId) ? row : null;
  },
});

export const remove = internalMutation({
  platforms: true,
  description: "Delete a preview record.",
  args: { ...identity, ...removeArgs },
  returns: v.null(),
  handler: async (ctx, { userId, previewId }) => {
    const row = await ctx.db.get("previews", previewId);
    if (row && await ownedApp(ctx, userId, row.appId)) await ctx.db.delete("previews", previewId);
    return null;
  },
});

export const removeForApp = internalMutation({
  args: appIdArgs,
  returns: v.null(),
  handler: async (ctx, { appId }): Promise<null> => {
    if (await ctx.db.get("apps", appId)) throw new ConvexError("App still exists.");

    const batchSize = 100;
    const rows = await ctx.db.query("previews")
      .withIndex("by_appId_and_gitRef", q => q.eq("appId", appId))
      .take(batchSize);
    await Promise.all(rows.map(row => ctx.db.delete("previews", row._id)));
    if (rows.length === batchSize) await ctx.scheduler.runAfter(0, internal.previews.internal.removeForApp, { appId });
    return null;
  },
});
