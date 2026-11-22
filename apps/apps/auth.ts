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

async function authRequest<T>(body: object, store: Store, signal?: AbortSignal): Promise<T> {
  const web = exactHost() === 'web';
  const url = web ? new URL('/api/auth/web', authCallback()).href : `${site}/api/auth/native`;
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
    case 'RATE_LIMITED': return 'Too many attempts. Wait a minute and try again.';
    case 'INVALID_CREDENTIALS': return 'Check your username and password.';
    case 'USERNAME_TAKEN': return 'That username is unavailable.';
    case 'PASSWORD_TOO_SHORT': return 'Use at least 15 characters for your password.';
    case 'PASSWORD_TOO_COMMON': return 'Choose a less common password.';
    default:
      if (code.startsWith('USERNAME_')) return 'Choose a shorter username using letters and numbers.';
      if (code.startsWith('PASSWORD_') || code === 'INVALID_REQUEST') return 'Check your username and password length and try again.';
      return create ? 'Could not create your account. Try again.' : 'Could not sign in. Try again.';
  }
}

let googleAttempt: AbortController | undefined;

async function googleSignIn(store: Store): Promise<AuthReply> {
  const attempt = new AbortController();
  googleAttempt = attempt;
  let prepared: string | null = null;
  try {
    if (exactHost() === 'web' && typeof prepareAuthSession === 'function') prepared = prepareAuthSession();
    const callback = authCallback();
    const state = crypto.randomUUID();
    const started = await authRequest<{ redirect: string; state: string }>({ operation: 'googleStart', callbackState: state }, store, attempt.signal);
    if (attempt.signal.aborted) return authFailure('Google sign-in was cancelled.');
    const options = { callback, state, prepared: prepared ?? undefined };
    const returned = new URL(await openAuthSession(started.redirect, options));
    if (attempt.signal.aborted) return authFailure('Google sign-in was cancelled.');
    const code = returned.searchParams.get('convexAuthCode');
    if (!code || returned.searchParams.has('convexAuthError')) return authFailure('Google sign-in was not completed.');
    const response = await authRequest<AuthResponse>({ operation: 'googleComplete', code, state: started.state }, store, attempt.signal);
    if (attempt.signal.aborted) return authFailure('Google sign-in was cancelled.');
    return acceptSession(response, store);
  } catch (error) {
    if (attempt.signal.aborted || (error instanceof Error && 'status' in error && error.status === 499)) {
      return authFailure('Google sign-in was cancelled.');
    }
    return authFailure('Could not sign in with Google. Try again.');
  } finally {
    if (googleAttempt === attempt) googleAttempt = undefined;
    if (prepared && typeof cancelAuthSession === 'function') cancelAuthSession(prepared);
  }
}

export const authSources: Pick<Sources, 'restoreSession' | 'passwordSession' | 'googleSession' | 'cancelGoogleSession' | 'signOut'> = {
  restoreSession: async (_args, store) => {
    try {
      return acceptSession(await authRequest<AuthResponse>({ operation: 'status' }, store), store);
    } catch {
      return authFailure('Could not check your session. Try again.');
    }
  },
  passwordSession: async ([username, password, create], store) => {
    try {
      const response = await authRequest<AuthResponse>({ operation: 'password', username, password, create }, store);
      return acceptSession(response, store);
    } catch (error) {
      return authFailure(passwordError(error, create));
    }
  },
  googleSession: (_args, store) => googleSignIn(store),
  cancelGoogleSession: () => {
    googleAttempt?.abort();
    return authFailure(exactHost() === 'web'
      ? 'Google sign-in cancelled. You can close the Google window.'
      : 'Google sign-in cancelled.');
  },
  signOut: async (_args, store) => {
    try {
      return acceptSession(await authRequest<AuthResponse>({ operation: 'signOut' }, store), store);
    } catch {
      return authFailure('Could not sign out. Try again to end your session.');
    }
  },
};
