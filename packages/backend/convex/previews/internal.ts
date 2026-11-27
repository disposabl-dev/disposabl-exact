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

export const create = internalMutation({
  platforms: true,
  description: "Create or get a named preview for an app.",
  args: { ...identity, ...createArgs },
  returns: preview,
  handler: async (ctx, { userId, appSlug, previewName }) => {
    const app = await requireOwnedApp(ctx, userId, appSlug);
    const name = previewName.trim();
    if (!name || name.length > 200) throw new ConvexError("Preview name must be 1–200 characters.");

    const nameSlug = name.normalize("NFKC").toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");
    if (!/[\p{L}\p{N}]/u.test(nameSlug)) {
      throw new ConvexError("Preview name must contain a letter or number.");
    }
    const previewSlug = `${app.slug}--${nameSlug}`;
    const existing = await ctx.db.query("previews")
      .withIndex("by_previewSlug", q => q.eq("previewSlug", previewSlug))
      .unique();
    if (existing) {
      if (existing.appId === app._id && existing.previewName === name) return presentPreview(existing, app);
      throw new ConvexError("A preview with this slug already exists. Choose another name.");
    }

    const id = await ctx.db.insert("previews", { appId: app._id, previewName: name, previewSlug, platforms: {} });
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
      .withIndex("by_appId", q => q.eq("appId", app._id))
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
      .withIndex("by_appId", q => q.eq("appId", appDocumentId))
      .take(batchSize);
    await Promise.all(rows.map(row => ctx.db.delete("previews", row._id)));
    if (rows.length === batchSize) await ctx.scheduler.runAfter(0, internal.previews.internal.removeForApp, { appDocumentId });
    return null;
  },
});
