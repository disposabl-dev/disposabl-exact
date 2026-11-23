import type { Autumn, CreatePlanParams, GetPlanResponse } from "autumn-js";
import { billingCatalog as catalog } from "./billingCatalog";

const feature = { featureId: catalog.featureId, name: "Credits", type: "metered", consumable: true } as const;
const monthly = {
  planId: catalog.monthly.autumnPlanId,
  name: "Monthly credits",
  price: { amount: catalog.monthly.amount, interval: "month" },
  items: [{ featureId: catalog.featureId, included: catalog.monthly.credits, reset: { interval: "month" } }],
} satisfies CreatePlanParams;
const topup = {
  planId: catalog.topup.autumnPlanId,
  name: "Credits top-up",
  addOn: true,
  items: [{
    featureId: catalog.featureId,
    price: { amount: catalog.topup.amount, billingUnits: catalog.topup.credits, interval: "one_off", billingMethod: "prepaid" },
  }],
} satisfies CreatePlanParams;

export function checkPlan(plan: GetPlanResponse) {
  if (plan.autoEnable || plan.active === false || plan.items.length !== 1) return false;
  const item = plan.items[0];
  if (item.featureId !== catalog.featureId) return false;
  const valid = plan.id === monthly.planId
    ? !plan.addOn && plan.price?.amount === catalog.monthly.amount && plan.price.interval === "month"
      && item?.included === catalog.monthly.credits && item.reset?.interval === "month"
    : plan.id === topup.planId && plan.addOn && plan.price === null && item.price?.amount === catalog.topup.amount
      && item.price.billingUnits === catalog.topup.credits && item.price.interval === "one_off"
      && item.price.billingMethod === "prepaid";
  return valid;
}

/** Scope writes to this catalog and version plan changes for future purchases. */
export async function syncBillingCatalog(client: Autumn, apply: boolean) {
  const [{ list: features }, { list: plans }] = await Promise.all([
    client.features.list(), client.plans.list({ includeArchived: true, allVersions: true }),
  ]);
  const featureExists = features.some(entry => entry.id === feature.featureId);
  const configured = [monthly, topup];
  const existing = configured.filter(plan => plans.some(entry => entry.id === plan.planId));
  const missing = configured.filter(plan => !existing.includes(plan));
  const currentPlans = await Promise.all(existing.map(plan => client.plans.get({ planId: plan.planId })));
  const drift = currentPlans.filter(plan => !checkPlan(plan)).map(plan => plan.id);
  const created: string[] = [];
  const updated: string[] = [];
  if (apply) {
    if (!featureExists) {
      await client.features.create(feature);
      created.push(feature.featureId);
    }
    for (const plan of missing) {
      await client.plans.create(plan);
      created.push(plan.planId);
    }
    for (const plan of existing.filter(plan => drift.includes(plan.planId))) {
      await client.plans.update({
        ...plan,
        price: "price" in plan ? plan.price : null,
        addOn: "addOn" in plan && plan.addOn,
        autoEnable: false,
        forceVersion: true,
      });
      const published = await client.plans.get({ planId: plan.planId });
      if (checkPlan(published)) updated.push(plan.planId);
    }
  }
  return {
    missing: [...(featureExists ? [] : [feature.featureId]), ...missing.map(plan => plan.planId)],
    drift: drift.filter(id => !updated.includes(id)),
    created,
    updated,
  };
}
