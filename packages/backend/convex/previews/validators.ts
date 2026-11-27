import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { appIdArgs } from "../apps/validators";
import schema from "../schema";

export const preview = schema.doc("previews");
export const previewOrNull = v.union(preview, v.null());
export const previewPage = paginationResultValidator(preview);

export const listArgs = { ...appIdArgs, paginationOpts: paginationOptsValidator };
export const getArgs = { previewSlug: v.string() };
export const createArgs = { ...appIdArgs, gitRef: v.string(), name: v.optional(v.string()) };
export const removeArgs = { previewId: v.id("previews"), confirm: v.literal(true) };
