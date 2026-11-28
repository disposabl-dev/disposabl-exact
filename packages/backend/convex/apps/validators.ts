import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import schema from "../schema";

export const app = schema.doc("apps")
  .omit("_id", "userId", "slug", "name", "agentThreadId")
  .extend({ appSlug: v.string(), appName: v.string() });
export const appOrNull = v.union(app, v.null());
export const appPage = paginationResultValidator(app);
export const createdApp = app.extend({ appId: v.id("apps") });

export const appSlugArgs = { appSlug: v.string() };
export const listArgs = { paginationOpts: paginationOptsValidator };
export const createArgs = {
  ...appSlugArgs,
  appName: v.string(),
};
export const removeArgs = { ...appSlugArgs, confirm: v.literal(true) };

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
  githubRepositoryId: v.number(),
  convexProjectId: v.number(),
  convexSiteUrl: v.string(),
};
