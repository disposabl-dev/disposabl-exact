import { acknowledge, consume } from '@exact/purchases';

import type { Result, Sources, Store } from './app.contract.d.ts';
import { appRequest, authSources } from './auth';

type BillingReply = Result<'startBilling'>;
const unavailable: BillingReply = { url: '', ok: false };

async function submitBilling<T>(body: object, store: Store): Promise<T> {
  const submit = () => appRequest<T>(body, store, undefined, 'billing');
  try {
    return await submit();
  } catch (error) {
    // Only a rejected session is safe to retry. Preserve the purchase request ID.
    if (!(error instanceof Error) || error.message !== 'SIGN_IN_REQUIRED') throw error;
    const restored = await authSources.restoreSession([], store);
    if (!restored.signedIn) throw error;
    return submit();
  }
}

export const billingSources = {
  async loadBilling([, platform], store) {
    return appRequest<Result<'loadBilling'>>({ operation: 'status', platform }, store, undefined, 'billing');
  },
  async startBilling([operation, offer, platform], store) {
    try {
      const result = await submitBilling<{ url?: string; ok?: boolean }>(
        { operation, offer, platform, requestId: crypto.randomUUID() }, store,
      );
      return { url: result.url ?? '', ok: !!(result.url || result.ok) };
    } catch {
      return unavailable;
    }
  },
  async deliverPurchases([platform, accountToken, monthly, topup, queued], store) {
    if (!accountToken || platform === 'none' || exactHost() === 'web') return unavailable;
    let settled = false;
    for (const purchase of queued.slice(0, 12)) {
      const offer = purchase.itemId === monthly ? 'monthly' : purchase.itemId === topup ? 'topup' : null;
      const proof = platform === 'app-store' ? purchase.apple?.jwsRepresentation : purchase.purchaseToken;
      if (!offer || !proof || purchase.purchaseState !== 'purchased') continue;
      try {
        await submitBilling(
          { operation: 'storePurchase', platform, offer, proof }, store,
        );
        if (!purchase.acknowledged) {
          const options = { purchaseToken: purchase.purchaseToken };
          if (offer === 'topup') await consume(options);
          else await acknowledge(options);
        }
        settled = true;
      } catch {
        // Leave it unfinished. The same receipt can be rechecked after a restart.
      }
    }
    return { url: '', ok: settled };
  },
} satisfies Pick<Sources, 'loadBilling' | 'startBilling' | 'deliverPurchases'>;
