"use node";

import { randomUUID } from "node:crypto";
import { Environment } from "@apple/app-store-server-library";
import { Autumn } from "autumn-js";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import { verifyAppleNotification, verifyAppleTransaction } from "./billingApple";
import { billingCatalog as catalog } from "./billingCatalog";
import { checkPlan, syncBillingCatalog } from "./billingSync";
import { verifyGooglePlayPurchase, verifyPlayPush } from "./billingGoogle";
import { billingOffer, billingPlatform, billingStatus } from "./billingTypes";
import type { Infer } from "convex/values";

type Platform = Infer<typeof billingPlatform>;
type Offer = Infer<typeof billingOffer>;
const day = 24 * 60 * 60 * 1000;
const returnPath = "/pricing";

function billingMode(): "off" | "preview" | "production" {
  const key = env.AUTUMN_SECRET_KEY?.trim();
  if (env.BILLING_MODE === "preview" && (!key || key.startsWith("am_sk_test_"))) return "preview";
  if (env.BILLING_MODE === "production" && key?.startsWith("am_sk_live_")) return "production";
  return "off";
}

function webEnabled() {
  return billingMode() !== "off" && !!env.AUTUMN_SECRET_KEY?.trim();
}

function autumn() {
  if (!webEnabled()) throw new Error("Billing unavailable");
  return new Autumn({ secretKey: env.AUTUMN_SECRET_KEY!.trim() });
}

function appleConfig() {
  const bundleId = env.BILLING_APPLE_BUNDLE_ID;
  const appAppleId = Number(env.BILLING_APPLE_APP_ID);
  const rootCertificates = env.BILLING_APPLE_ROOTS?.split(",").filter(Boolean)
    .map(value => Buffer.from(value.trim(), "base64"));
  if (!bundleId || !Number.isSafeInteger(appAppleId) || appAppleId <= 0 || !rootCertificates?.length ||
    rootCertificates.some(cert => !cert.length)) return null;
  return { bundleId, appAppleId, rootCertificates, environment: Environment.PRODUCTION as const };
}

function googleConfig() {
  const packageName = env.BILLING_GOOGLE_PACKAGE;
  if (!packageName || !env.BILLING_GOOGLE_SERVICE_ACCOUNT) return null;
  try {
    const serviceAccount = JSON.parse(env.BILLING_GOOGLE_SERVICE_ACCOUNT);
    if (typeof serviceAccount.client_email !== "string" || typeof serviceAccount.private_key !== "string") return null;
    return { packageName, serviceAccount: { clientEmail: serviceAccount.client_email as string, privateKey: serviceAccount.private_key as string } };
  } catch {
    return null;
  }
}

function storeEnabled(platform: Platform | null) {
  if (billingMode() !== "production") return false;
  return platform === "app-store" ? env.BILLING_APPLE_CONNECTED === "true" && appleConfig() !== null
    : platform === "google-play" && googleConfig() !== null && Boolean(env.BILLING_GOOGLE_PUSH_AUDIENCE && env.BILLING_GOOGLE_PUSH_EMAIL);
}

function storeProduct(platform: Platform, offer: Offer) {
  return platform === "app-store" ? catalog[offer].appleProductId : catalog[offer].googleProductId;
}

function billingAccount(ctx: ActionCtx, userId: Id<"users">) {
  return ctx.runMutation(internal.billingData.account, { userId, token: randomUUID() });
}

function customerId(userId: Id<"users">) {
  return `exact-${userId}`;
}

function hasMonthly(customer: Awaited<ReturnType<Autumn["customers"]["getOrCreate"]>>) {
  return customer.subscriptions.some(plan => plan.planId === catalog.monthly.autumnPlanId);
}

async function getStatus(ctx: ActionCtx, userId: Id<"users"> | null, platform: Platform | null) {
  const mode = billingMode();
  const available = storeEnabled(platform);
  const status = {
    mode, webEnabled: webEnabled(), authenticated: userId !== null, monthlyActive: false, credits: null as number | null,
    currency: catalog.currency, monthlyAmount: catalog.monthly.amount, monthlyCredits: catalog.monthly.credits,
    topupAmount: catalog.topup.amount, topupCredits: catalog.topup.credits,
    accountToken: "", storeEnabled: available,
    monthlyProduct: available && platform ? storeProduct(platform, "monthly") : "",
    topupProduct: available && platform ? storeProduct(platform, "topup") : "",
  };
  if (!userId || mode === "off") return status;

  const [account, customer, nativeMonthly] = await Promise.all([
    billingAccount(ctx, userId),
    webEnabled() ? autumn().customers.getOrCreate({ customerId: customerId(userId) }) : null,
    ctx.runQuery(internal.billingData.nativeMonthly, { userId, preview: mode === "preview", now: Date.now() }),
  ]);
  return {
    ...status,
    accountToken: account.token,
    monthlyActive: (customer !== null && hasMonthly(customer)) || nativeMonthly,
    credits: (customer?.balances[catalog.featureId]?.remaining ?? 0)
      + (mode === "preview" ? account.previewTopupCredits : account.topupCredits)
      + (nativeMonthly ? catalog.monthly.credits : 0),
  };
}

export const status = internalAction({
  args: { userId: v.union(v.id("users"), v.null()), platform: v.union(billingPlatform, v.null()) },
  returns: billingStatus,
  handler: (ctx, { userId, platform }): Promise<Infer<typeof billingStatus>> => getStatus(ctx, userId, platform),
});

function safeCheckoutUrl(url: string | null | undefined) {
  if (!url) throw new Error("No checkout URL");
  const destination = new URL(url);
  if (destination.protocol !== "https:" || destination.username || destination.password) throw new Error("Unsafe checkout URL");
  return destination.href;
}

export const checkout = internalAction({
  args: { userId: v.id("users"), offer: billingOffer, requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, { userId, offer, requestId }): Promise<string> => {
    const client = autumn();
    const id = customerId(userId);
    const [customer, publishedPlan] = await Promise.all([
      client.customers.getOrCreate({ customerId: id }),
      client.plans.get({ planId: catalog[offer].autumnPlanId }),
    ]);
    if (!checkPlan(publishedPlan)) throw new Error("Published plan differs from billingCatalog");
    const now = Date.now();
    if (offer === "monthly" && (hasMonthly(customer) ||
      await ctx.runQuery(internal.billingData.nativeMonthly, { userId, preview: billingMode() === "preview", now }))) throw new Error("Monthly plan already exists");

    // Stripe Checkout expires within 24 hours. Reuse the attempt while the session
    // can still accept payment, including when the response from Autumn is lost.
    const attempt = await ctx.runMutation(internal.billingData.reserveCheckout, {
      userId, offer, requestId, now, expiresAt: now + day + 5 * 60 * 1000,
    });
    if (!attempt.reserved) return safeCheckoutUrl(attempt.url);
    const checkout = await client.billing.attach({
      customerId: id,
      planId: catalog[offer].autumnPlanId,
      ...(offer === "topup" ? {
        featureQuantities: [{ featureId: catalog.featureId, quantity: catalog.topup.credits, adjustable: false }],
      } : {}),
      redirectMode: "always",
      enablePlan: "on_payment",
      successUrl: new URL(returnPath, env.CONVEX_SITE_URL).href,
    });
    const url = safeCheckoutUrl(checkout.paymentUrl);
    await ctx.runMutation(internal.billingData.saveCheckout, { id: attempt.id, url });
    return url;
  },
});

export const portal = internalAction({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (_ctx, { userId }) => {
    const result = await autumn().billing.openCustomerPortal({
      customerId: customerId(userId), returnUrl: new URL(returnPath, env.CONVEX_SITE_URL).href,
    });
    return safeCheckoutUrl(result.url);
  },
});

export const previewPurchase = internalAction({
  args: { userId: v.id("users"), offer: billingOffer, requestId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, offer, requestId }) => {
    if (billingMode() !== "preview") throw new Error("Test purchases unavailable");
    const account = await billingAccount(ctx, userId);
    await ctx.runMutation(internal.billingData.record, {
      token: account.token,
      purchase: {
        platform: "preview", transactionId: `${userId}:${requestId}`, reference: requestId,
        offer, expiresAt: offer === "monthly" ? Date.now() + 30 * day : null, revoked: false,
      },
    });
    return null;
  },
});

export const storePurchase = internalAction({
  args: {
    userId: v.id("users"), platform: billingPlatform, offer: billingOffer, proof: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, platform, offer, proof }) => {
    if (!storeEnabled(platform)) throw new Error("Store billing unavailable");
    const account = await billingAccount(ctx, userId);
    const productId = storeProduct(platform, offer);
    if (platform === "app-store") {
      const verified = await verifyAppleTransaction(proof, appleConfig()!, {
        accountToken: account.token, productId, kind: offer === "monthly" ? "subscription" : "consumable",
      });
      await ctx.runMutation(internal.billingData.record, { token: account.token, purchase: {
        platform, offer, transactionId: verified.providerTransactionId,
        reference: verified.originalTransactionId, expiresAt: verified.expiresAt, revoked: false,
      } });
    } else {
      const verified = await verifyGooglePlayPurchase({
        ...googleConfig()!, productId, purchaseToken: proof, obfuscatedAccountId: account.token,
        kind: offer === "monthly" ? "monthly" : "one_time", environment: "production",
      });
      // The app finishes Play purchases only when this committed grant succeeds.
      await ctx.runMutation(internal.billingData.record, { token: account.token, purchase: {
        platform, offer, transactionId: verified.transactionId,
        reference: verified.reference, expiresAt: verified.expiresAt, revoked: false,
      } });
    }
    return null;
  },
});


export const syncCatalog = internalAction({
  args: { apply: v.boolean() },
  returns: v.object({ missing: v.array(v.string()), drift: v.array(v.string()), created: v.array(v.string()), updated: v.array(v.string()) }),
  handler: async (_ctx, { apply }) => syncBillingCatalog(autumn(), apply),
});


export const appleNotification = internalAction({
  args: { signedPayload: v.string() },
  returns: v.null(),
  handler: async (ctx, { signedPayload }) => {
    if (!storeEnabled("app-store")) throw new Error("Apple billing unavailable");
    const event = await verifyAppleNotification(signedPayload, appleConfig()!, {
      monthly: catalog.monthly.appleProductId, topup: catalog.topup.appleProductId,
    });
    if (!event) return null;
    const { transaction, offer } = event;
    await ctx.runMutation(internal.billingData.record, { token: transaction.accountToken, purchase: {
      platform: "app-store", offer, transactionId: transaction.providerTransactionId,
      reference: transaction.originalTransactionId, expiresAt: transaction.expiresAt, revoked: transaction.revokedAt !== null,
    } });
    return null;
  },
});

export const googleNotification = internalAction({
  args: { idToken: v.string(), data: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { idToken, data }) => {
    if (!storeEnabled("google-play") || !await verifyPlayPush(idToken, env.BILLING_GOOGLE_PUSH_AUDIENCE!, env.BILLING_GOOGLE_PUSH_EMAIL!)) {
      return false;
    }
    const config = googleConfig()!;
    const event: {
      packageName?: string;
      subscriptionNotification?: { purchaseToken?: string };
      oneTimeProductNotification?: { purchaseToken?: string };
      voidedPurchaseNotification?: { purchaseToken?: string };
    } = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    if (event.packageName !== config.packageName) return false;
    const proof = event.subscriptionNotification?.purchaseToken ?? event.voidedPurchaseNotification?.purchaseToken
      ?? event.oneTimeProductNotification?.purchaseToken;
    if (!proof) return true;
    const owner = await ctx.runQuery(internal.billingData.storeOwner, { platform: "google-play", reference: proof });
    if (!owner) return true;
    const verified = await verifyGooglePlayPurchase({
      ...config, productId: storeProduct("google-play", owner.offer), purchaseToken: proof,
      obfuscatedAccountId: owner.token, kind: owner.offer === "monthly" ? "monthly" : "one_time",
      environment: "production", allowInactive: true,
    });
    await ctx.runMutation(internal.billingData.record, { token: owner.token, purchase: {
      platform: "google-play", offer: owner.offer, transactionId: verified.transactionId,
      reference: verified.reference, expiresAt: verified.expiresAt, revoked: verified.revoked,
    } });
    return true;
  },
});
