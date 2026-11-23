import type { Result, Sources } from './app.contract.d.ts';
import { appRequest, authSources } from './auth';

export const billingSources = {
  async loadBilling(_, store) {
    const billing = await appRequest<Omit<Result<'loadBilling'>, 'web'>>({ operation: 'status' }, store, undefined, 'billing');
    return { ...billing, web: exactHost() === 'web' };
  },
  async startBilling([operation, offer], store) {
    const body = { operation, offer, requestId: crypto.randomUUID() };
    const submit = () => appRequest<Result<'startBilling'>>(body, store, undefined, 'billing');
    try {
      return await submit();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'SIGN_IN_REQUIRED') throw error;
      if (!(await authSources.restoreSession([], store)).signedIn) throw error;
      return submit();
    }
  },
} satisfies Pick<Sources, 'loadBilling' | 'startBilling'>;
