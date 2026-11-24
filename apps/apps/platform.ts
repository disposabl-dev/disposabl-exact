import type { Result, Sources } from './app.contract.d.ts';

declare global {
  var exactPlatformWeb: boolean | undefined;
  function submitMcpConsent(request: string, decision: string): void;
}

const credentials = '/api/platform/credentials';
const emptyConsent = { client: '', destination: '', scopes: [] };

function webRequest(path: string, body?: object) {
  if (exactHost() !== 'web') throw new Error('Requires the web app');
  const headers = new Headers({ 'X-Exact-Auth': '1' });
  if (body) headers.set('Content-Type', 'application/json');
  return fetch(new URL(path, authCallback()).href, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    redirect: 'error',
  });
}

async function changeCredentials(body: object): Promise<Result<'createKey'>> {
  const response = await webRequest(credentials, body);
  if (!response.ok) throw new Error('Could not update credentials');
  const result = await response.json();
  return { key: result.key ?? '' };
}

export const platformSources = {
  loadMcpConsent: async ([id]): Promise<Result<'loadMcpConsent'>> => {
    const response = await webRequest(`/api/mcp/consent?request=${encodeURIComponent(id)}`);
    if (response.status === 400 || response.status === 404)
      return { ...emptyConsent, error: 'expired' };
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
  listCredentials: async (): Promise<Result<'listCredentials'>> => {
    const response = await webRequest(credentials);
    if (!response.ok) throw new Error('Could not load credentials');
    return response.json();
  },
  createKey: ([name, write]) => changeCredentials({ operation: 'create', name, write }),
  revokeConnection: ([id]) => changeCredentials({ operation: 'revoke', id }),
} satisfies Pick<Sources, 'loadMcpConsent' | 'decideMcpConsent' | 'listCredentials' | 'createKey' | 'revokeConnection'>;
