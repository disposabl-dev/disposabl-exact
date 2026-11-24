import { getAuthUserId } from "@convex-dev/auth/server";
import { Autumn, type CreatePlanParams, type GetPlanResponse } from "autumn-js";
import { v, type Infer } from "convex/values";
import { appPlatform as platform } from "../../app-platform";
import { env, internalAction, query } from "../_generated/server";

const feature = { featureId: "disposabl_credits", name: "Credits", type: "metered", consumable: true } as const;
const monthly = {
  planId: "disposabl_monthly",
  name: "Monthly credits",
  price: { amount: 5, interval: "month" },
  items: [{ featureId: feature.featureId, included: 750, reset: { interval: "month" } }],
} satisfies CreatePlanParams;
const topup = {
  planId: "disposabl_topup",
  name: "Credits top-up",
  addOn: true,
  items: [{
    featureId: feature.featureId,
    price: { amount: 5, billingUnits: 500, interval: "one_off", billingMethod: "prepaid" },
  }],
} satisfies CreatePlanParams;
const offers = {
  currency: "USD",
  monthlyAmount: monthly.price.amount,
  monthlyCredits: monthly.items[0].included,
  topupAmount: topup.items[0].price.amount,
  topupCredits: topup.items[0].price.billingUnits,
};

function matchesPlan(plan: GetPlanResponse) {
  const [item] = plan.items;
  if (plan.active === false || plan.autoEnable || plan.items.length !== 1 || item.featureId !== feature.featureId) return false;
  if (plan.id === monthly.planId) {
    return !plan.addOn && plan.price?.interval === "month" && plan.price.amount === offers.monthlyAmount
      && item.included === offers.monthlyCredits && item.reset?.interval === "month" && !item.price;
  }
  return plan.id === topup.planId && plan.addOn && !plan.price && item.price?.billingMethod === "prepaid"
    && item.price.interval === "one_off" && item.price.amount === offers.topupAmount
    && item.price.billingUnits === offers.topupCredits;
}

export const viewerId = query({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    if (!platform.payments) return null;
    const userId = await getAuthUserId(ctx);
    return userId && await ctx.db.get("users", userId) ? userId : null;
  },
});

const operation = v.union(v.literal("status"), v.literal("checkout"), v.literal("portal"));
const offer = v.union(v.literal("monthly"), v.literal("topup"));
const result = v.union(
  v.object({
    mode: v.union(v.literal("off"), v.literal("test"), v.literal("live")),
    credits: v.union(v.number(), v.null()),
    monthlyActive: v.boolean(),
    planId: v.union(v.string(), v.null()),
    managedOnWeb: v.boolean(),
    currency: v.string(),
    monthlyAmount: v.number(),
    monthlyCredits: v.number(),
    topupAmount: v.number(),
    topupCredits: v.number(),
  }),
  v.object({ url: v.string() }),
);

export const request = internalAction({
  args: { userId: v.union(v.id("users"), v.null()), operation, offer: v.optional(offer), requestId: v.optional(v.string()) },
  returns: result,
  handler: async (_ctx, { userId, operation, offer, requestId }): Promise<Infer<typeof result>> => {
    if (!platform.payments) throw new Error("Enable payments in disposabl.json");
    const secretKey = env.AUTUMN_SECRET_KEY?.trim();
    const mode = secretKey?.startsWith("am_sk_test_") ? "test" : secretKey?.startsWith("am_sk_live_") ? "live" : "off";
    const client = mode === "off" ? null : new Autumn({ secretKey });
    const customerId = userId ? `exact-${userId}` : null;
    const customer = client && customerId ? await client.customers.getOrCreate({
      customerId,
      ...(operation === "status" ? { expand: ["invoices"] } : {}),
    }) : null;
    const subscriptions = customer?.subscriptions.filter(plan => plan.planId === monthly.planId) ?? [];
    const active = subscriptions.find(plan => plan.status === "active");
    const monthlyActive = subscriptions.length > 0;

    if (operation === "status") {
      const latestInvoice = active && customer?.invoices
        ?.filter(invoice => invoice.planIds.includes(active.planId) && invoice.createdAt >= active.startedAt)
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      return {
        ...offers, mode, monthlyActive,
        planId: active?.planId ?? null,
        managedOnWeb: latestInvoice?.processorType === "stripe",
        credits: customer ? customer.balances[feature.featureId]?.remaining ?? 0 : null,
      };
    }
    if (!client || !customerId) throw new Error("Billing unavailable");
    const returnUrl = new URL("/pricing", env.CONVEX_SITE_URL).href;

    if (operation === "portal") {
      return { url: (await client.billing.openCustomerPortal({ customerId, returnUrl })).url };
    }

    if (!offer || !requestId || (offer === "monthly" && monthlyActive)) throw new Error("Checkout unavailable");
    const planId = offer === "monthly" ? monthly.planId : topup.planId;
    if (!matchesPlan(await client.plans.get({ planId }))) throw new Error("Autumn plan differs from the configured offer");
    const checkout = await client.billing.attach({
      customerId, planId,
      ...(offer === "topup" ? { featureQuantities: [{ featureId: feature.featureId, quantity: offers.topupCredits, adjustable: false }] } : {}),
      redirectMode: "always",
      enablePlan: "on_payment",
      successUrl: returnUrl,
    }, { headers: { "Idempotency-Key": `${customerId}:${offer}:${requestId}` } });
    if (!checkout.paymentUrl) throw new Error("No checkout URL");
    return { url: checkout.paymentUrl };
  },
});

// Only manage the IDs in this catalog. The Autumn account can contain other apps' plans.
export const syncCatalog = internalAction({
  args: { apply: v.boolean() },
  returns: v.array(v.string()),
  handler: async (_ctx, { apply }) => {
    if (!platform.payments) throw new Error("Enable payments in disposabl.json");
    const secretKey = env.AUTUMN_SECRET_KEY?.trim();
    if (!secretKey) throw new Error("Set AUTUMN_SECRET_KEY first");
    const client = new Autumn({ secretKey });
    const [features, plans] = await Promise.all([client.features.list(), client.plans.list()]);
    const changes: string[] = [];
    if (!features.list.some(entry => entry.id === feature.featureId)) {
      changes.push(`Create ${feature.featureId}`);
      if (apply) await client.features.create(feature);
    }
    for (const plan of [monthly, topup]) {
      if (!plans.list.some(entry => entry.id === plan.planId)) {
        changes.push(`Create ${plan.planId}`);
        if (apply) await client.plans.create(plan);
      } else if (!matchesPlan(await client.plans.get({ planId: plan.planId }))) {
        changes.push(`Version ${plan.planId}`);
        if (apply) await client.plans.update({
          ...plan,
          price: "price" in plan ? plan.price : null,
          addOn: "addOn" in plan,
          autoEnable: false,
          forceVersion: true,
        });
      }
    }
    return changes;
  },
});
