import type { Result, Sources } from './app.contract.d.ts';

declare global {
  function submitMcpConsent(request: string, decision: string): void;
}

const empty = { client: '', destination: '', scopes: [] };

export const consentSources = {
  webHost: () => ({ enabled: exactHost() === 'web' }),
  loadMcpConsent: async ([id]): Promise<Result<'loadMcpConsent'>> => {
    if (exactHost() !== 'web') return { ...empty, error: 'expired' };
    const url = new URL('/api/mcp/consent', authCallback());
    url.searchParams.set('request', id);
    const response = await fetch(url.href, {
      headers: { 'X-Exact-Auth': '1' },
      credentials: 'include',
      redirect: 'error',
    });
    if (response.status === 400 || response.status === 404)
      return { ...empty, error: 'expired' };
    if (!response.ok) throw new Error('Could not load consent');
    const data = await response.json();
    return { client: data.client, destination: data.destination, scopes: data.scopes, error: '' };
  },
  decideMcpConsent: ([id, decision]) => {
    if (exactHost() !== 'web' || typeof submitMcpConsent !== 'function')
      return { error: 'unavailable' };
    submitMcpConsent(id, decision);
    return { error: '' };
  },
} satisfies Pick<Sources, 'webHost' | 'loadMcpConsent' | 'decideMcpConsent'>;
