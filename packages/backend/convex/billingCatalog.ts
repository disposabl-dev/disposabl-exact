export const billingCatalog = {
  featureId: "disposabl_credits",
  currency: "USD",
  monthly: {
    autumnPlanId: "disposabl_monthly",
    appleProductId: "disposabl.monthly",
    googleProductId: "disposabl_monthly",
    amount: 5,
    credits: 750,
  },
  topup: {
    autumnPlanId: "disposabl_topup",
    appleProductId: "disposabl.credits.500",
    googleProductId: "disposabl_credits_500",
    amount: 5,
    credits: 500,
  },
} as const;
