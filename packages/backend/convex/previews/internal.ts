import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireOwnedApp } from "../apps/internal";
import { createArgs, getArgs, listArgs, preview, previewOrNull, previewPage, removeArgs } from "./validators";

const identity = { userId: v.id("users") };

function presentPreview(row: Doc<"previews">, app: Doc<"apps">): Infer<typeof preview> {
  const { _id, appId: _appId, ...fields } = row;
  return { ...fields, appSlug: app.slug, appName: app.name };
}

async function ownedPreview(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, previewSlug: string) {
  const row = await ctx.db.query("previews")
    .withIndex("by_previewSlug", q => q.eq("previewSlug", previewSlug))
    .unique();
  if (!row) return null;

  const app = await ctx.db.get("apps", row.appId);
  return app?.userId === userId ? { row, app } : null;
}

function slugPart(value: string, maxLength: number) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, maxLength).replace(/^-|-$/g, "");
}

export const create = internalMutation({
  platforms: true,
  description: "Create or get a preview record for an app's Git ref.",
  args: { ...identity, ...createArgs },
  returns: preview,
  handler: async (ctx, { userId, appSlug, gitRef, previewName }) => {
    const app = await requireOwnedApp(ctx, userId, appSlug);
    const name = previewName?.trim() ?? gitRef;
    if (!gitRef || gitRef.length > 200
      || /\s/.test(gitRef) || [...gitRef].some(char => char <= " " || char.charCodeAt(0) === 127)) {
      throw new ConvexError("Provide a Git ref of up to 200 characters without whitespace.");
    }
    if (!name || name.length > 200) throw new ConvexError("Invalid preview name.");

    const existing = await ctx.db.query("previews")
      .withIndex("by_appId_and_gitRef", q => q.eq("appId", app._id).eq("gitRef", gitRef))
      .unique();
    if (existing) return presentPreview(existing, app);

    const appSlugPart = slugPart(app.slug, 28) || "app";
    const refSlug = slugPart(gitRef, 24) || "preview";
    const suffix = crypto.randomUUID().slice(0, 8);
    const previewSlug = `${appSlugPart}--${refSlug}-${suffix}`;
    if (await ctx.db.query("previews").withIndex("by_previewSlug", q => q.eq("previewSlug", previewSlug)).unique()) {
      throw new ConvexError("Preview slug already exists. Retry creation.");
    }

    const id = await ctx.db.insert("previews", { appId: app._id, gitRef, previewName: name, previewSlug, platforms: {} });
    const row = await ctx.db.get("previews", id);
    if (!row) throw new ConvexError("Preview could not be saved.");
    return presentPreview(row, app);
  },
});

export const list = internalQuery({
  platforms: true,
  description: "List an app's previews.",
  args: { ...identity, ...listArgs },
  returns: previewPage,
  handler: async (ctx, { userId, appSlug, paginationOpts }) => {
    const app = await requireOwnedApp(ctx, userId, appSlug);
    const page = await ctx.db.query("previews")
      .withIndex("by_appId_and_gitRef", q => q.eq("appId", app._id))
      .paginate(paginationOpts);
    return { ...page, page: page.page.map(row => presentPreview(row, app)) };
  },
});

export const get = internalQuery({
  platforms: true,
  description: "Get a preview by its slug.",
  args: { ...identity, ...getArgs },
  returns: previewOrNull,
  handler: async (ctx, { userId, previewSlug }) => {
    const result = await ownedPreview(ctx, userId, previewSlug);
    return result ? presentPreview(result.row, result.app) : null;
  },
});

export const remove = internalMutation({
  platforms: true,
  description: "Delete a preview record.",
  args: { ...identity, ...removeArgs },
  returns: v.null(),
  handler: async (ctx, { userId, previewSlug }) => {
    const result = await ownedPreview(ctx, userId, previewSlug);
    if (result) await ctx.db.delete("previews", result.row._id);
    return null;
  },
});

export const removeForApp = internalMutation({
  args: { appDocumentId: v.id("apps") },
  returns: v.null(),
  handler: async (ctx, { appDocumentId }): Promise<null> => {
    if (await ctx.db.get("apps", appDocumentId)) throw new ConvexError("App still exists.");

    const batchSize = 100;
    const rows = await ctx.db.query("previews")
      .withIndex("by_appId_and_gitRef", q => q.eq("appId", appDocumentId))
      .take(batchSize);
    await Promise.all(rows.map(row => ctx.db.delete("previews", row._id)));
    if (rows.length === batchSize) await ctx.scheduler.runAfter(0, internal.previews.internal.removeForApp, { appDocumentId });
    return null;
  },
});
