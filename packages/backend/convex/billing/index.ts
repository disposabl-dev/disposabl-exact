import { internalAction } from "@disposabl-kit/server";
import { readBillingStatus, statusResult } from "@disposabl-kit/server/billing/index.ts";
import { v } from "convex/values";

export { request } from "@disposabl-kit/server/billing/index.ts";

export const status = internalAction({
  platforms: true,
  feature: "payments",
  readOnly: true,
  description: "Read the account's plan, credits, and billing status.",
  args: { userId: v.id("users") },
  returns: statusResult,
  handler: (_ctx, { userId }) => readBillingStatus(userId),
});
