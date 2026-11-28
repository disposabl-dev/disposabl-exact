import { query } from "../_generated/server";
import { requireUserId } from "../lib/requireUserId";
import { readStatus } from "./internal";
import { connectionsStatus } from "./validators";

export const status = query({
  args: {},
  returns: connectionsStatus,
  handler: async ctx => readStatus(ctx, await requireUserId(ctx)),
});
