import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { billingCatalog } from "./billingCatalog";
import { billingOffer, billingPlatform, billingTransaction } from "./billingTypes";

export const viewerId = query({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId && await ctx.db.get("users", userId) ? userId : null;
  },
});

export const account = internalMutation({
  args: { userId: v.id("users"), token: v.string() },
  returns: v.object({ token: v.string(), topupCredits: v.number(), previewTopupCredits: v.number() }),
  handler: async (ctx, { userId, token }) => {
    const current = await ctx.db.query("billingAccounts").withIndex("by_userId", q => q.eq("userId", userId)).unique();
    if (current) return { token: current.token, topupCredits: current.topupCredits, previewTopupCredits: current.previewTopupCredits };
    await ctx.db.insert("billingAccounts", { userId, token, topupCredits: 0, previewTopupCredits: 0 });
    return { token, topupCredits: 0, previewTopupCredits: 0 };
  },
});

export const nativeMonthly = internalQuery({
  args: { userId: v.id("users"), preview: v.boolean(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { userId, preview, now }) => !!await ctx.db.query("billingTransactions")
    .withIndex("by_userId_and_preview_and_offer_and_revoked_and_expiresAt", q => q
      .eq("userId", userId).eq("preview", preview).eq("offer", "monthly").eq("revoked", false).gt("expiresAt", now)).first(),
});

export const record = internalMutation({
  args: { token: v.string(), purchase: billingTransaction },
  returns: v.null(),
  handler: async (ctx, { token, purchase }) => {
    const owner = await ctx.db.query("billingAccounts").withIndex("by_token", q => q.eq("token", token)).unique();
    if (!owner) throw new Error("Unknown billing account");
    const preview = purchase.platform === "preview";
    const credited = purchase.offer === "topup" ? billingCatalog.topup.credits : 0;
    const existing = await ctx.db.query("billingTransactions").withIndex("by_platform_and_transactionId", q => q
      .eq("platform", purchase.platform).eq("transactionId", purchase.transactionId)).unique();
    if (existing) {
      if (existing.userId !== owner.userId || existing.offer !== purchase.offer) throw new Error("Purchase owner mismatch");
      if (existing.revoked || !purchase.revoked) return null;
      await ctx.db.patch("billingTransactions", existing._id, { revoked: true });
    } else {
      await ctx.db.insert("billingTransactions", { ...purchase, userId: owner.userId, preview, credited });
    }
    if (purchase.offer === "topup" && (!purchase.revoked || existing)) {
      const change = purchase.revoked ? -(existing?.credited ?? 0) : credited;
      const field = preview ? "previewTopupCredits" : "topupCredits";
      await ctx.db.patch("billingAccounts", owner._id, { [field]: owner[field] + change });
    }
    return null;
  },
});

export const reserveCheckout = internalMutation({
  args: { userId: v.id("users"), offer: billingOffer, requestId: v.string(), now: v.number(), expiresAt: v.number() },
  returns: v.object({ id: v.id("billingCheckouts"), reserved: v.boolean(), url: v.union(v.string(), v.null()) }),
  handler: async (ctx, { userId, offer, requestId, now, expiresAt }) => {
    const existing = offer === "monthly"
      ? await ctx.db.query("billingCheckouts").withIndex("by_userId_and_offer_and_expiresAt", q => q
        .eq("userId", userId).eq("offer", offer).gt("expiresAt", now)).first()
      : await ctx.db.query("billingCheckouts").withIndex("by_userId_and_offer_and_requestId", q => q
        .eq("userId", userId).eq("offer", offer).eq("requestId", requestId)).unique();
    if (existing) return { id: existing._id, reserved: false, url: existing.url ?? null };
    const id = await ctx.db.insert("billingCheckouts", { userId, offer, requestId, expiresAt });
    return { id, reserved: true, url: null };
  },
});

export const saveCheckout = internalMutation({
  args: { id: v.id("billingCheckouts"), url: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, url }) => {
    await ctx.db.patch("billingCheckouts", id, { url });
    return null;
  },
});


export const storeOwner = internalQuery({
  args: { platform: billingPlatform, reference: v.string() },
  returns: v.union(v.object({ token: v.string(), offer: billingOffer }), v.null()),
  handler: async (ctx, { platform, reference }) => {
    const purchase = await ctx.db.query("billingTransactions").withIndex("by_platform_and_reference", q => q
      .eq("platform", platform).eq("reference", reference)).order("desc").first();
    if (!purchase) return null;
    const owner = await ctx.db.query("billingAccounts").withIndex("by_userId", q => q.eq("userId", purchase.userId)).unique();
    return owner ? { token: owner.token, offer: purchase.offer } : null;
  },
});
