"use node";

import { JWT, OAuth2Client } from "google-auth-library";

export type GooglePlayVerificationInput = {
  packageName: string;
  productId: string;
  purchaseToken: string;
  obfuscatedAccountId: string;
  kind: "monthly" | "one_time";
  environment: "production" | "test";
  allowInactive?: boolean;
  serviceAccount: { clientEmail: string; privateKey: string };
};

export type GooglePlayPurchase = {
  provider: "google_play";
  reference: string;
  transactionId: string;
  productId: string;
  kind: "monthly" | "one_time";
  expiresAt: number | null;
  revoked: boolean;
  finishState: "acknowledged" | "needs_acknowledgement" | "consumed" | "needs_consumption";
};

const publisher = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const pushClient = new OAuth2Client();

async function accessToken(account: GooglePlayVerificationInput["serviceAccount"]): Promise<string> {
  const client = new JWT({
    email: account.clientEmail,
    key: account.privateKey,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Missing Google access token");
  return token.token;
}

export async function verifyPlayPush(idToken: string, audience: string, email: string) {
  const claims = (await pushClient.verifyIdToken({ idToken, audience })).getPayload();
  return claims?.email_verified === true && claims.email === email;
}

/** All identifiers and expected environment must come from trusted server configuration. */
export async function verifyGooglePlayPurchase(input: GooglePlayVerificationInput): Promise<GooglePlayPurchase> {
  if (!input.packageName || !input.productId || !input.purchaseToken || !input.obfuscatedAccountId) throw new Error("Missing Google Play verification input");
  const token = await accessToken(input.serviceAccount);
  const resource = input.kind === "monthly" ? "subscriptionsv2" : "productsv2";
  const response = await fetch(`${publisher}/${encodeURIComponent(input.packageName)}/purchases/${resource}/tokens/${encodeURIComponent(input.purchaseToken)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Play verification failed (${response.status})`);
  const body = await response.json();
  const isTest = input.kind === "monthly" ? body.testPurchase != null : body.testPurchaseContext != null;
  if (isTest !== (input.environment === "test")) throw new Error("Google Play environment mismatch");
  const account = input.kind === "monthly" ? body.externalAccountIdentifiers?.obfuscatedExternalAccountId : body.obfuscatedExternalAccountId;
  if (account !== input.obfuscatedAccountId) throw new Error("Google Play account mismatch");
  if (input.kind === "monthly") {
    const entitled = ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"].includes(body.subscriptionState);
    if (!entitled && !(input.allowInactive && body.subscriptionState === "SUBSCRIPTION_STATE_EXPIRED")) {
      throw new Error("Google Play subscription is not entitled");
    }
    const items = body.lineItems?.filter((item: any) => item.productId === input.productId) ?? [];
    if (items.length !== 1 || body.lineItems.length !== 1) throw new Error("Google Play product mismatch");
    const item = items[0];
    const expiresAt = Date.parse(item.expiryTime);
    if (!Number.isFinite(expiresAt) || (!input.allowInactive && expiresAt <= Date.now()) || !item.latestSuccessfulOrderId) throw new Error("Google Play subscription has no current paid entitlement");
    if (!["ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", "ACKNOWLEDGEMENT_STATE_PENDING"].includes(body.acknowledgementState)) throw new Error("Unknown Google Play acknowledgement state");
    return { provider: "google_play", reference: input.purchaseToken, transactionId: item.latestSuccessfulOrderId, productId: input.productId, kind: input.kind, expiresAt, revoked: !entitled, finishState: body.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" ? "acknowledged" : "needs_acknowledgement" };
  }
  const state = body.purchaseStateContext?.purchaseState;
  if (state !== "PURCHASED" && !(input.allowInactive && state === "CANCELLED")) {
    throw new Error("Google Play purchase is not complete");
  }
  if (body.productLineItem?.length !== 1 || body.productLineItem[0].productId !== input.productId || !body.orderId) throw new Error("Google Play product or order mismatch");
  const details = body.productLineItem[0].productOfferDetails;
  if (details?.quantity !== 1) throw new Error("Unexpected Google Play purchase quantity");
  const consumption = details.consumptionState;
  if (state === "PURCHASED" && !["CONSUMPTION_STATE_CONSUMED", "CONSUMPTION_STATE_YET_TO_BE_CONSUMED"].includes(consumption)) throw new Error("Unknown Google Play consumption state");
  return { provider: "google_play", reference: input.purchaseToken, transactionId: body.orderId, productId: input.productId, kind: input.kind, expiresAt: null, revoked: state === "CANCELLED", finishState: consumption === "CONSUMPTION_STATE_CONSUMED" ? "consumed" : "needs_consumption" };
}
