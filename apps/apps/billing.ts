import type { Result, Sources } from './app.contract.d.ts';
import { appRequest, authSources } from './auth';

declare global {
  function goToBilling(url: string): void;
}

export const billingSources = {
  async loadBilling(_, store) {
    const billing = await appRequest<Omit<Result<'loadBilling'>, 'web'>>({ operation: 'status' }, store, undefined, 'billing');
    return { ...billing, web: exactHost() === 'web' };
  },
  async startBilling([operation, offer], store) {
    if (typeof goToBilling !== 'function') throw new Error('Billing requires the web app');
    const body = { operation, offer, requestId: crypto.randomUUID() };
    const submit = () => appRequest<{ url: string }>(body, store, undefined, 'billing');
    const { url } = await submit().catch(async error => {
      if (!(error instanceof Error) || error.message !== 'SIGN_IN_REQUIRED') throw error;
      if (!(await authSources.restoreSession([], store)).signedIn) throw error;
      return submit();
    });
    goToBilling(url);
    return { ok: true };
  },
} satisfies Pick<Sources, 'loadBilling' | 'startBilling'>;
