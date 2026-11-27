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
  githubOwner: v.string(),
  githubRepoName: v.string(),
  convexProjectId: v.number(),
};
export const removeArgs = { ...appSlugArgs, confirm: v.literal(true) };
