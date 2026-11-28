import { internalAction, internalMutation, internalQuery } from "@disposabl-kit/server";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { findConnection } from "../connections/internal";
import {
  app, appSlugArgs, appOrNull, appPage, createForUserArgs,
  creationPlan, listArgs, removeArgs, saveCreatedAppArgs,
} from "./validators";

const identity = { userId: v.id("users") };

function presentApp(row: Doc<"apps">): Infer<typeof app> {
  const { _id, userId: _userId, agentThreadId: _agentThreadId, name, slug, ...fields } = row;
  return { ...fields, appName: name, appSlug: slug };
}

export function findAppBySlug(ctx: Pick<QueryCtx, "db">, appSlug: string) {
  return ctx.db.query("apps").withIndex("by_slug", q => q.eq("slug", appSlug)).unique();
}

export async function ownedApp(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, appSlug: string) {
  const row = await findAppBySlug(ctx, appSlug);
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

export const create = internalAction({
  platforms: true,
  description: "Create a private GitHub repository and a Convex project, then configure GitHub Actions.",
  args: createForUserArgs,
  returns: app,
  handler: (ctx, args): Promise<Infer<typeof app>> =>
    ctx.runAction(internal.apps.actions.create.provision, args),
});

export const prepareCreation = internalQuery({
  args: createForUserArgs,
  returns: creationPlan,
  handler: async (ctx, args): Promise<Infer<typeof creationPlan>> => {
    const { userId, mode = "agent" } = args;
    const name = args.appName.trim();
    const slug = args.appSlug.trim().toLowerCase();
    if (!name || name.length > 100) throw new ConvexError("App name must be 1–100 characters.");
    if (slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new ConvexError("Use a slug of up to 63 letters, numbers, and single hyphens.");
    }

    const user = await ctx.db.get("users", userId);
    if (!user) throw new ConvexError("Sign in to continue.");
    const existing = await findAppBySlug(ctx, slug);
    if (existing && (existing.userId !== userId || existing.name !== name)) {
      throw new ConvexError("App slug is already in use.");
    }
    if (existing) return { status: "complete", app: presentApp(existing) };

    const connection = await findConnection(ctx, userId);
    const managedGitHub = !connection?.github;
    const managedConvex = !connection?.convex;
    if (mode === "local" && (managedGitHub || managedConvex)) {
      throw new ConvexError("Connect GitHub and Convex to create an app in local mode.");
    }

    if ((managedGitHub || managedConvex) && await ctx.db.query("apps")
      .withIndex("by_userId", q => q.eq("userId", userId)).first()) {
      throw new ConvexError("Connect GitHub and Convex to create another app.");
    }
    if (await ctx.db.query("previews").withIndex("by_appSlug", q => q.eq("appSlug", slug)).first()) {
      throw new ConvexError("This app is still being removed. Try again shortly.");
    }

    const githubOwner = managedGitHub ? "disposabl-dev" : connection?.github?.owner.toLowerCase();
    const githubInstallationId = managedGitHub ? null : connection?.github?.installationId;
    const convexTeamId = managedConvex ? Number(env.DISPOSABL_CONVEX_TEAM_ID) : connection?.convex?.teamId;
    const convexAccessToken = managedConvex ? env.DISPOSABL_CONVEX_TEAM_TOKEN : connection?.convex?.accessToken;
    if (!env.DISPOSABL_GITHUB_APP_ID || !env.DISPOSABL_GITHUB_APP_PRIVATE_KEY) {
      throw new ConvexError("GitHub app provisioning is unavailable.");
    }
    if (!githubOwner || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(githubOwner)
      || githubInstallationId === undefined
      || (githubInstallationId !== null && !/^[1-9][0-9]*$/.test(githubInstallationId))) {
      throw new ConvexError("Reconnect GitHub before creating the app.");
    }
    if (!convexTeamId || convexTeamId < 1 || !Number.isSafeInteger(convexTeamId) || !convexAccessToken?.trim()) {
      throw new ConvexError(managedConvex ? "Disposabl's Convex team is unavailable." : "Reconnect Convex before creating the app.");
    }
    return {
      status: "provision", appSlug: slug, appName: name,
      githubOwner, githubInstallationId, convexTeamId, convexAccessToken: convexAccessToken.trim(), managedConvex,
    };
  },
});

export const saveCreatedApp = internalMutation({
  args: saveCreatedAppArgs,
  returns: app,
  handler: async (ctx, { appSlug: slug, appName: name, ...fields }) => {
    const existing = await findAppBySlug(ctx, slug);
    if (existing) {
      if (existing.userId === fields.userId && existing.name === name) return presentApp(existing);
      throw new ConvexError("App slug is already in use.");
    }

    const id = await ctx.db.insert("apps", { ...fields, slug, name, prod: null, live: null });
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
    await ctx.db.delete("apps", row._id);
    await ctx.runMutation(internal.previews.internal.removeForApp, { appSlug: row.slug });
    return null;
  },
});
