import { v } from "convex/values";

export const billingOffer = v.union(v.literal("monthly"), v.literal("topup"));
export const billingPlatform = v.union(v.literal("app-store"), v.literal("google-play"));
export const billingMode = v.union(v.literal("off"), v.literal("preview"), v.literal("production"));
export const billingTransaction = v.object({
  platform: v.union(billingPlatform, v.literal("preview")),
  transactionId: v.string(),
  reference: v.string(),
  offer: billingOffer,
  expiresAt: v.union(v.number(), v.null()),
  revoked: v.boolean(),
});

export const billingStatus = v.object({
  mode: billingMode,
  authenticated: v.boolean(),
  webEnabled: v.boolean(),
  monthlyActive: v.boolean(),
  credits: v.union(v.number(), v.null()),
  currency: v.string(),
  monthlyAmount: v.number(),
  monthlyCredits: v.number(),
  topupAmount: v.number(),
  topupCredits: v.number(),
  storeEnabled: v.boolean(),
  accountToken: v.string(),
  monthlyProduct: v.string(),
  topupProduct: v.string(),
});
