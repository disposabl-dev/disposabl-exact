import { internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { findAppBySlug, ownedApp, requireOwnedApp } from "../apps/internal";
import { appSlugArgs } from "../apps/validators";
import { createArgs, getArgs, listArgs, preview, previewOrNull, previewPage, previewRef, removeArgs } from "./validators";

const identity = { userId: v.id("users") };

function presentPreview(row: Doc<"previews">, app: Doc<"apps">): Infer<typeof preview> {
  const { _id, ...fields } = row;
  return { ...fields, appId: app._id, appName: app.name, previewId: _id };
}

async function ownedPreview(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, { previewId, previewSlug }: Infer<typeof previewRef>) {
  if ((!previewId && !previewSlug) || (previewId && previewSlug !== undefined)) {
    throw new ConvexError("Provide either previewId or previewSlug.");
  }
  const row = previewId ? await ctx.db.get("previews", previewId) : await ctx.db.query("previews")
    .withIndex("by_previewSlug", q => q.eq("previewSlug", previewSlug ?? ""))
    .unique();
  if (!row) return null;

  const app = await ownedApp(ctx, userId, { appSlug: row.appSlug });
  return app ? { row, app } : null;
}

export const create = internalMutation({
  platforms: true,
  description: "Create or get a named preview for an app.",
  args: { ...identity, ...createArgs },
  returns: preview,
  handler: async (ctx, { userId, previewName, ...ref }) => {
    const app = await requireOwnedApp(ctx, userId, ref);
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
      if (existing.appSlug === app.slug && existing.previewName === name) return presentPreview(existing, app);
      throw new ConvexError("A preview with this slug already exists. Choose another name.");
    }

    const id = await ctx.db.insert("previews", { appSlug: app.slug, previewName: name, previewSlug, platforms: {} });
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
  handler: async (ctx, { userId, paginationOpts, ...ref }) => {
    const app = await requireOwnedApp(ctx, userId, ref);
    const page = await ctx.db.query("previews")
      .withIndex("by_appSlug", q => q.eq("appSlug", app.slug))
      .paginate(paginationOpts);
    return { ...page, page: page.page.map(row => presentPreview(row, app)) };
  },
});

export const get = internalQuery({
  platforms: true,
  description: "Get a preview by its slug or ID.",
  args: { ...identity, ...getArgs },
  returns: previewOrNull,
  handler: async (ctx, { userId, ...ref }) => {
    const result = await ownedPreview(ctx, userId, ref);
    return result ? presentPreview(result.row, result.app) : null;
  },
});

export const remove = internalMutation({
  platforms: true,
  description: "Delete a preview record.",
  args: { ...identity, ...removeArgs },
  returns: v.null(),
  handler: async (ctx, { userId, confirm: _confirm, ...ref }) => {
    const result = await ownedPreview(ctx, userId, ref);
    if (result) await ctx.db.delete("previews", result.row._id);
    return null;
  },
});

export const removeForApp = internalMutation({
  args: appSlugArgs,
  returns: v.null(),
  handler: async (ctx, { appSlug }): Promise<null> => {
    if (await findAppBySlug(ctx, appSlug)) return null;

    const batchSize = 100;
    const rows = await ctx.db.query("previews")
      .withIndex("by_appSlug", q => q.eq("appSlug", appSlug))
      .take(batchSize);
    await Promise.all(rows.map(row => ctx.db.delete("previews", row._id)));
    if (rows.length === batchSize) await ctx.scheduler.runAfter(0, internal.previews.internal.removeForApp, { appSlug });
    return null;
  },
});
