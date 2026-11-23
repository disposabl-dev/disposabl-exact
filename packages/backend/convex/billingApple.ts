"use node";

import { Environment, NotificationTypeV2, SignedDataVerifier, Type } from "@apple/app-store-server-library";

/** Certificates must be trusted Apple root CA certificates, supplied as DER buffers. */
export type AppleVerificationConfig = {
  bundleId: string;
  appAppleId: number;
  environment: Environment.PRODUCTION | Environment.SANDBOX;
  rootCertificates: Buffer[];
};
export type AppleExpectedPurchase = {
  accountToken: string;
  productId: string;
  kind: "subscription" | "consumable";
};

function verifier(config: AppleVerificationConfig) {
  if (!config.bundleId || !Number.isSafeInteger(config.appAppleId) || config.appAppleId <= 0 || !config.rootCertificates.length || config.rootCertificates.some((c) => !c.length) || ![Environment.PRODUCTION, Environment.SANDBOX].includes(config.environment)) {
    throw new Error("Invalid Apple verification configuration");
  }
  return new SignedDataVerifier(config.rootCertificates, true, config.environment, config.bundleId, config.appAppleId);
}

function normalize(transaction: Awaited<ReturnType<SignedDataVerifier["verifyAndDecodeTransaction"]>>, config: AppleVerificationConfig, expected: AppleExpectedPurchase, allowRevoked: boolean) {
  const { transactionId, originalTransactionId, purchaseDate, productId, appAccountToken, expiresDate, revocationDate } = transaction;
  if (!expected.accountToken || !expected.productId || transaction.bundleId !== config.bundleId || transaction.environment !== config.environment || transaction.inAppOwnershipType !== "PURCHASED" || appAccountToken?.toLowerCase() !== expected.accountToken.toLowerCase() || productId !== expected.productId || transaction.type !== (expected.kind === "subscription" ? Type.AUTO_RENEWABLE_SUBSCRIPTION : Type.CONSUMABLE) || !transactionId || !originalTransactionId || !Number.isSafeInteger(purchaseDate) || !purchaseDate || (expected.kind === "subscription" && (!Number.isSafeInteger(expiresDate) || !expiresDate)) || (expected.kind === "consumable" && transaction.quantity !== 1) || transaction.isUpgraded || (!allowRevoked && (revocationDate != null || (expiresDate != null && expiresDate <= Date.now())))) {
    throw new Error("Apple transaction does not match an eligible purchase");
  }
  return { accountToken: appAccountToken, providerTransactionId: transactionId, originalTransactionId, purchaseDate, expiresAt: expiresDate ?? null, revokedAt: revocationDate ?? null, productId, kind: expected.kind };
}

/** Verify a signed transaction before granting an entitlement or credit. */
export async function verifyAppleTransaction(signedTransaction: string, config: AppleVerificationConfig, expected: AppleExpectedPurchase) {
  return normalize(await verifier(config).verifyAndDecodeTransaction(signedTransaction), config, expected, false);
}

/** Verify both signed layers before resolving a configured product and account. */
export async function verifyAppleNotification(
  signedPayload: string,
  config: AppleVerificationConfig,
  products: { monthly: string; topup: string },
) {
  const appleVerifier = verifier(config);
  const notification = await appleVerifier.verifyAndDecodeNotification(signedPayload);
  const type = notification.notificationType as NotificationTypeV2 | undefined;
  if (!type || ![NotificationTypeV2.SUBSCRIBED, NotificationTypeV2.DID_RENEW,
    NotificationTypeV2.ONE_TIME_CHARGE, NotificationTypeV2.REFUND, NotificationTypeV2.REVOKE].includes(type)) return null;
  if (!notification.data?.signedTransactionInfo) throw new Error("Apple notification has no transaction");
  const transaction = await appleVerifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo);
  if (!transaction.appAccountToken) return null;
  const offer: "monthly" | "topup" | null = transaction.productId === products.monthly ? "monthly"
    : transaction.productId === products.topup ? "topup" : null;
  if (!offer) return null;
  return { offer, transaction: normalize(transaction, config, {
    accountToken: transaction.appAccountToken,
    productId: products[offer],
    kind: offer === "monthly" ? "subscription" : "consumable",
  }, true) };
}
