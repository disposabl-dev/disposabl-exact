import type { Answer, Result, Sources } from './app.contract.d.ts';
import { authGrants, authSources } from './auth';
import { billingSources } from './billing';
import { languages } from './locales.generated';
import { convex } from '@exact/convex';
import { getFunctionName, makeFunctionReference } from 'convex/server';
import { convexToJson, jsonToConvex } from 'convex/values';

declare global {
  var exactPlatformWeb: boolean | undefined;
  function submitMcpConsent(request: string, decision: string): void;
}

const origin = import.meta.env.CONVEX_ORIGIN;
export const grants = `net.websocket ${origin}\n${authGrants}
net.fetch https://itunes.apple.com`;

const client = convex(origin, { getFunctionName, convexToJson, jsonToConvex });
const getFeatures = makeFunctionReference<'query', Record<string, never>, Omit<Result<'loadAppFeatures'>, 'ready'>>('app:features');
const credentials = '/api/dashboard/api-keys';

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

const sources: Sources = {
  ...authSources,
  ...billingSources,
  loadMcpConsent: async ([id]) => {
    const response = await webRequest(`/api/mcp/consent?request=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('Could not load consent');
    return response.json();
  },
  decideMcpConsent: ([id, decision]) => {
    if (exactHost() !== 'web' || typeof submitMcpConsent !== 'function')
      throw new Error('Requires the top-level web app');
    submitMcpConsent(id, decision);
    return { ok: true };
  },
  listCredentials: async () => {
    const response = await webRequest(credentials);
    if (!response.ok) throw new Error('Could not load credentials');
    return response.json();
  },
  createKey: ([name, write]) => changeCredentials({ operation: 'create', name, write }),
  revokeConnection: ([id]) => changeCredentials({ operation: 'revoke', id }),
  locales: () => ({ choices: languages }),
  live: () => client.live(),
  loadAppFeatures: async ([rev]) => {
    const flags = await client.query(rev, getFeatures, {});
    const topLevelWeb = exactHost() === 'web' && globalThis.exactPlatformWeb === true;
    return { ...flags, ready: true, credentials: topLevelWeb && flags.credentials, consent: topLevelWeb && flags.consent };
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
