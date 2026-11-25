import { Autumn, AutumnError, type GetCustomerResponse, type GetPlanResponse } from "autumn-js";
import { v, type Infer } from "convex/values";
import { platform } from "../platform";
import type { Id } from "../../../backend/convex/_generated/dataModel";
import { env, internalAction } from "../../../backend/convex/_generated/server";

const credits = "disposabl_credits";
const plans = { monthly: "disposabl_monthly", topup: "disposabl_topup" };
const offers = { currency: "USD", monthlyAmount: 5, monthlyCredits: 750, topupAmount: 5, topupCredits: 500 };

function matchesPlan(plan: GetPlanResponse) {
  const [item] = plan.items;
  if (plan.active === false || plan.autoEnable || plan.items.length !== 1 || item.featureId !== credits) return false;
  if (plan.id === plans.monthly) {
    return !plan.addOn && plan.price?.interval === "month" && plan.price.amount === offers.monthlyAmount
      && item.included === offers.monthlyCredits && item.reset?.interval === "month" && !item.price;
  }
  return plan.id === plans.topup && plan.addOn && !plan.price && item.price?.billingMethod === "prepaid"
    && item.price.interval === "one_off" && item.price.amount === offers.topupAmount
    && item.price.billingUnits === offers.topupCredits;
}

const operation = v.union(v.literal("status"), v.literal("checkout"), v.literal("portal"));
const offer = v.union(v.literal("monthly"), v.literal("topup"));
export const statusResult = v.object({
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
});
const result = v.union(statusResult, v.object({ url: v.string() }));

function billingProvider() {
  if (!platform.payments) throw new Error("Enable payments in disposabl.json");
  const secretKey = env.AUTUMN_SECRET_KEY?.trim();
  const mode = secretKey?.startsWith("am_sk_test_") ? "test" : secretKey?.startsWith("am_sk_live_") ? "live" : "off";
  return { mode, client: mode === "off" ? null : new Autumn({ secretKey }) } as const;
}

function accountStatus(mode: Infer<typeof statusResult>["mode"], customer: Pick<GetCustomerResponse, "subscriptions" | "invoices" | "balances"> | null) {
  const subscriptions = customer?.subscriptions.filter(plan => plan.planId === plans.monthly) ?? [];
  const active = subscriptions.find(plan => plan.status === "active");
  const latestInvoice = active && customer?.invoices
    ?.filter(invoice => invoice.planIds.includes(active.planId) && invoice.createdAt >= active.startedAt)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  return {
    ...offers, mode,
    monthlyActive: subscriptions.length > 0,
    planId: active?.planId ?? null,
    managedOnWeb: latestInvoice?.processorType === "stripe",
    credits: customer ? customer.balances[credits]?.remaining ?? 0 : null,
  };
}

export async function readBillingStatus(userId: Id<"users">) {
  const { client, mode } = billingProvider();
  if (!client) return accountStatus(mode, null);
  const customer = await client.customers.get({ customerId: `exact-${userId}`, expand: ["invoices"] })
    .catch(error => {
      if (error instanceof AutumnError && error.statusCode === 404) return null;
      throw new Error("Billing unavailable");
    });
  return accountStatus(mode, customer);
}

export const request = internalAction({
  args: { userId: v.union(v.id("users"), v.null()), operation, offer: v.optional(offer), requestId: v.optional(v.string()) },
  returns: result,
  handler: async (_ctx, { userId, operation, offer, requestId }): Promise<Infer<typeof result>> => {
    const { client, mode } = billingProvider();
    const customerId = userId ? `exact-${userId}` : null;
    const customer = client && customerId ? await client.customers.getOrCreate({
      customerId,
      ...(operation === "status" ? { expand: ["invoices"] } : {}),
    }) : null;
    if (operation === "status") return accountStatus(mode, customer);
    const monthlyActive = customer?.subscriptions.some(plan => plan.planId === plans.monthly) ?? false;
    if (!client || !customerId) throw new Error("Billing unavailable");
    const returnUrl = new URL("/dashboard/billing", env.CONVEX_SITE_URL).href;

    if (operation === "portal") {
      return { url: (await client.billing.openCustomerPortal({ customerId, returnUrl })).url };
    }

    if (!offer || !requestId || (offer === "monthly" && monthlyActive)) throw new Error("Checkout unavailable");
    const planId = plans[offer];
    if (!matchesPlan(await client.plans.get({ planId }))) throw new Error("Autumn plan differs from the configured offer");
    const checkout = await client.billing.attach({
      customerId, planId,
      ...(offer === "topup" ? { featureQuantities: [{ featureId: credits, quantity: offers.topupCredits, adjustable: false }] } : {}),
      redirectMode: "always",
      enablePlan: "on_payment",
      successUrl: returnUrl,
    }, { headers: { "Idempotency-Key": `${customerId}:${offer}:${requestId}` } });
    if (!checkout.paymentUrl) throw new Error("No checkout URL");
    return { url: checkout.paymentUrl };
  },
});
