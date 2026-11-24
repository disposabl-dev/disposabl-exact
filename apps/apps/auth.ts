import type { Result, Sources, Store } from './app.contract.d.ts';

const site = import.meta.env.CONVEX_SITE_ORIGIN ?? 'http://127.0.0.1:3211';
const nativeCallback = 'dev.disposabl.exact:/oauth/google';
const sessionKey = 'exact.auth.session';
export const authGrants = [
  `net.fetch ${site}`,
  'auth.session https://accounts.google.com',
  `auth.callback ${site}/.exact/auth/callback`,
  `auth.callback ${nativeCallback}`,
  `secret.keep ${sessionKey}`,
].join('\n');

declare global {
  // Exact's web host supports pre-opening a window during the button press.
  function prepareAuthSession(): string | null;
  function cancelAuthSession(prepared: string): void;
}

type AuthReply = Result<'restoreSession'>;
type AuthResponse = { viewer: { name: string } | null; google: boolean; session?: string };

export async function appRequest<T>(body: object, store: Store, signal?: AbortSignal, route = "auth"): Promise<T> {
  const web = exactHost() === 'web';
  const url = web ? new URL(`/api/${route}/web`, authCallback()).href : `${site}/api/${route}/native`;
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Exact-Auth': '1' });
  const session = web ? null : store.get(sessionKey);
  if (session) headers.set('X-Exact-Session', session);
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(typeof result.error === 'string' ? result.error : 'UNAVAILABLE');
  }
  return response.json();
}

function acceptSession(response: AuthResponse, store: Store): AuthReply {
  if (exactHost() === 'native') {
    if (response.session) store.set(sessionKey, response.session);
    else if (!response.viewer) store.forget(sessionKey);
  }
  return {
    signedIn: response.viewer !== null,
    name: response.viewer?.name ?? '',
    google: response.google,
    error: '',
  };
}

function authFailure(error: string): AuthReply {
  return { signedIn: false, name: '', google: false, error };
}

function passwordError(error: unknown, create: boolean): string {
  const code = error instanceof Error ? error.message : '';
  switch (code) {
    case 'RATE_LIMITED': return 'rate-limited';
    case 'INVALID_CREDENTIALS': return 'invalid-credentials';
    case 'USERNAME_TAKEN': return 'username-taken';
    case 'PASSWORD_TOO_SHORT': return 'password-short';
    case 'PASSWORD_TOO_COMMON': return 'password-common';
    default:
      if (code.startsWith('USERNAME_')) return 'username-invalid';
      if (code.startsWith('PASSWORD_') || code === 'INVALID_REQUEST') return 'password-invalid';
      return create ? 'create-account' : 'sign-in';
  }
}

let googleAttempt: AbortController | undefined;
let googleTicket: { code: string; state: string } | undefined;
const googleError = 'google-failed';

async function openGoogleSession(store: Store): Promise<Result<'openGoogleSession'>> {
  const attempt = new AbortController();
  googleAttempt = attempt;
  googleTicket = undefined;
  let prepared: string | null = null;
  try {
    if (exactHost() === 'web' && typeof prepareAuthSession === 'function') prepared = prepareAuthSession();
    const callback = authCallback();
    const state = crypto.randomUUID();
    const started = await appRequest<{ redirect: string; state: string }>({ operation: 'googleStart', callbackState: state }, store, attempt.signal);
    if (attempt.signal.aborted) return { error: 'google-cancelled' };
    const options = { callback, state, prepared: prepared ?? undefined };
    const returned = new URL(await openAuthSession(started.redirect, options));
    if (attempt.signal.aborted) return { error: 'google-cancelled' };
    const code = returned.searchParams.get('convexAuthCode');
    if (!code || returned.searchParams.has('convexAuthError')) return { error: 'google-incomplete' };
    googleTicket = { code, state: started.state };
    return { error: '' };
  } catch (error) {
    if (attempt.signal.aborted || (error instanceof Error && 'status' in error && error.status === 499)) {
      return { error: 'google-cancelled' };
    }
    return { error: googleError };
  } finally {
    if (googleAttempt === attempt) googleAttempt = undefined;
    if (prepared && typeof cancelAuthSession === 'function') cancelAuthSession(prepared);
  }
}

export const authSources = {
  restoreSession: async (_args, store) => {
    try {
      return acceptSession(await appRequest<AuthResponse>({ operation: 'status' }, store), store);
    } catch {
      return authFailure('session-check');
    }
  },
  passwordSession: async ([username, password, create], store) => {
    try {
      const response = await appRequest<AuthResponse>({ operation: 'password', username, password, create }, store);
      return acceptSession(response, store);
    } catch (error) {
      return authFailure(passwordError(error, create));
    }
  },
  openGoogleSession: (_args, store) => openGoogleSession(store),
  cancelGoogleSession: () => {
    googleAttempt?.abort();
    googleTicket = undefined;
    return { error: exactHost() === 'web'
      ? 'google-cancelled-web'
      : 'google-cancelled' };
  },
  finishGoogleSession: async (_args, store) => {
    const ticket = googleTicket;
    googleTicket = undefined;
    if (!ticket) return authFailure(googleError);
    try {
      const response = await appRequest<AuthResponse>({ operation: 'googleComplete', ...ticket }, store);
      return acceptSession(response, store);
    } catch {
      return authFailure(googleError);
    }
  },
  signOut: async (_args, store) => {
    try {
      return acceptSession(await appRequest<AuthResponse>({ operation: 'signOut' }, store), store);
    } catch {
      return authFailure('sign-out');
    }
  },
} satisfies Pick<Sources, 'restoreSession' | 'passwordSession' | 'openGoogleSession' | 'cancelGoogleSession' | 'finishGoogleSession' | 'signOut'>;
