import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { appRef } from "../apps/validators";
import schema from "../schema";

export const preview = schema.doc("previews")
  .omit("_id")
  .extend({ appId: v.id("apps"), appName: v.string(), previewId: v.id("previews") });
export const previewOrNull = v.union(preview, v.null());
export const previewPage = paginationResultValidator(preview);

export const listArgs = { ...appRef.fields, paginationOpts: paginationOptsValidator };
export const previewRef = v.object({ previewSlug: v.optional(v.string()), previewId: v.optional(v.id("previews")) });
export const getArgs = previewRef.fields;
export const createArgs = { ...appRef.fields, previewName: v.string() };
export const removeArgs = { ...getArgs, confirm: v.literal(true) };
