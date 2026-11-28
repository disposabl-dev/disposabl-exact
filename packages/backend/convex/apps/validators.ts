import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import schema from "../schema";
import { appRef } from "./references";

export { appRef } from "./references";

export const app = schema.doc("apps")
  .omit("_id", "userId", "slug", "name", "agentThreadId", "publishKeyId")
  .extend({ appId: v.id("apps"), appSlug: v.string(), appName: v.string() });
export const appOrNull = v.union(app, v.null());
export const appPage = paginationResultValidator(app);
export const createdApp = app;

export const appSlugArgs = { appSlug: v.string() };
export const listArgs = { paginationOpts: paginationOptsValidator };
export const createArgs = {
  ...appSlugArgs,
  appName: v.string(),
};
export const removeArgs = { ...appRef.fields, confirm: v.literal(true) };

export const publishPath = "/api/apps/publish";
export const publishResultArgs = v.object({
  platform: v.union(v.literal("web"), v.literal("android"), v.literal("ios"), v.literal("macos")),
  commitSha: v.string(),
  url: v.optional(v.string()),
});

export const createForUserArgs = { userId: v.id("users"), ...createArgs };

export const creationPlan = v.union(
  v.object({ status: v.literal("complete"), app: createdApp }),
  v.object({
    status: v.literal("provision"),
    ...appSlugArgs,
    appName: v.string(),
    githubOwner: v.string(),
    githubInstallationId: v.string(),
    convexTeamId: v.number(),
    convexAccessToken: v.string(),
  }),
);

export const saveCreatedAppArgs = {
  userId: v.id("users"),
  ...appSlugArgs,
  appName: v.string(),
  githubOwner: v.string(),
  githubRepoName: v.string(),
  convexProjectId: v.number(),
  convexSiteUrl: v.string(),
};
