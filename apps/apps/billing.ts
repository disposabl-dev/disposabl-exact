import { acknowledge, consume } from '@exact/purchases';

import type { Result, Sources } from './app.contract.d.ts';
import { appRequest } from './auth';

type BillingReply = Result<'startBilling'>;
const unavailable: BillingReply = { url: '', ok: false };

export const billingSources = {
  async loadBilling([, platform], store) {
    return appRequest<Result<'loadBilling'>>({ operation: 'status', platform }, store, undefined, 'billing');
  },
  async startBilling([operation, offer, platform], store) {
    try {
      const result = await appRequest<{ url?: string; ok?: boolean }>(
        { operation, offer, platform, requestId: crypto.randomUUID() }, store, undefined, 'billing',
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
        await appRequest(
          { operation: 'storePurchase', platform, offer, proof }, store, undefined, 'billing',
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
