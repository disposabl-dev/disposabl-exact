import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { recordResult, report } from "./validation";

type PlatformResult = NonNullable<Doc<"apps">["prod"]>["web"];

function accepts(previous: PlatformResult, next: NonNullable<NonNullable<PlatformResult>["run"]>) {
  const current = previous?.run;
  if (!current) return true;
  if (current.number !== next.number) return next.number > current.number;
  if (current.id !== next.id) return false;
  if (current.attempt !== next.attempt) return next.attempt > current.attempt;
  return previous.status === "building";
}

export const record = internalMutation({
  args: {
    ...report.fields,
    repositoryId: v.number(),
    githubOwner: v.string(),
    pullRequest: v.optional(v.number()),
    commitSha: v.string(),
    run: v.object({ id: v.number(), number: v.number(), attempt: v.number() }),
  },
  returns: recordResult,
  handler: async (ctx, { repositoryId, githubOwner, pullRequest, platform, status, url, commitSha, run }) => {
    const app = await ctx.db.query("apps")
      .withIndex("by_githubRepositoryId", q => q.eq("githubRepositoryId", repositoryId)).unique();
    if (!app || app.githubOwner.toLowerCase() !== githubOwner) return "not_found" as const;

    const name = `pr-${pullRequest}`;
    const previewSlug = `${app.slug}--${name}`;
    const preview = pullRequest ? await ctx.db.query("previews")
      .withIndex("by_previewSlug", q => q.eq("previewSlug", previewSlug)).unique() : null;
    const platforms = pullRequest ? preview?.platforms : app.prod;
    const previous = platforms?.[platform];
    if (!accepts(previous, run)) return "ignored" as const;
    if (!pullRequest && url && (platform === "web" || platform === "api" || platform === "mcp") &&
        (!app.convexSiteUrl || new URL(url).origin !== new URL(app.convexSiteUrl).origin)) return "invalid_url" as const;

    const updated = { ...platforms, [platform]: { status, commitSha, run, url: url ?? previous?.url } };
    if (preview) await ctx.db.patch("previews", preview._id, { platforms: updated });
    else if (pullRequest) await ctx.db.insert("previews", { appSlug: app.slug, previewName: name, previewSlug, platforms: updated });
    else await ctx.db.patch("apps", app._id, { prod: updated });
    return "recorded" as const;
  },
});
