import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import schema from "../schema";

export const app = schema.doc("apps");
export const appOrNull = v.union(app, v.null());
export const appPage = paginationResultValidator(app);

export const appIdArgs = { appId: v.id("apps") };
export const listArgs = { paginationOpts: paginationOptsValidator };
export const createArgs = {
  name: v.string(),
  slug: v.string(),
  githubOwner: v.string(),
  githubRepoName: v.string(),
  convexProjectId: v.number(),
};
export const removeArgs = { ...appIdArgs, confirm: v.literal(true) };
