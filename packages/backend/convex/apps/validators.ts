import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import schema from "../schema";

export const app = schema.doc("apps")
  .omit("_id", "userId", "slug", "name", "agentThreadId")
  .extend({ appSlug: v.string(), appName: v.string() });
export const appOrNull = v.union(app, v.null());
export const appPage = paginationResultValidator(app);

export const appSlugArgs = { appSlug: v.string() };
export const listArgs = { paginationOpts: paginationOptsValidator };
export const createArgs = {
  ...appSlugArgs,
  appName: v.string(),
  mode: v.optional(v.union(v.literal("agent"), v.literal("local"))),
};
export const removeArgs = { ...appSlugArgs, confirm: v.literal(true) };

export const createForUserArgs = { userId: v.id("users"), ...createArgs };

export const creationPlan = v.union(
  v.object({ status: v.literal("complete"), app }),
  v.object({
    status: v.literal("provision"),
    ...appSlugArgs,
    appName: v.string(),
    githubOwner: v.string(),
    githubInstallationId: v.union(v.string(), v.null()),
    convexTeamId: v.number(),
    convexAccessToken: v.string(),
    managedConvex: v.boolean(),
  }),
);

export const saveCreatedAppArgs = {
  userId: v.id("users"),
  ...appSlugArgs,
  appName: v.string(),
  githubOwner: v.string(),
  githubRepoName: v.string(),
  convexProjectId: v.number(),
};
