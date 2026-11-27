import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { appSlugArgs } from "../apps/validators";
import schema from "../schema";

export const preview = schema.doc("previews")
  .omit("_id")
  .extend({ appName: v.string() });
export const previewOrNull = v.union(preview, v.null());
export const previewPage = paginationResultValidator(preview);

export const listArgs = { ...appSlugArgs, paginationOpts: paginationOptsValidator };
export const getArgs = { previewSlug: v.string() };
export const createArgs = { ...appSlugArgs, previewName: v.string() };
export const removeArgs = { ...getArgs, confirm: v.literal(true) };
