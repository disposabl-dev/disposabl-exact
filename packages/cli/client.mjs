import { accessToken, hasCredentials, login, NotAuthenticated } from "./auth.mjs";
import { sandboxSession } from "./sandbox.mjs";

export function apiOrigin(value) {
  const url = URL.parse(value);
  const localhost = url?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!url || (url.protocol !== "https:" && !localhost) || url.href !== url.origin + "/") {
    throw new Error("Use an HTTPS API origin, or an HTTP loopback origin for local development.");
  }
  return url.origin;
}

export function providerLink(provider, value) {
  const url = URL.parse(value);
  const expected = provider === "github" ? "https://github.com" : "https://dashboard.convex.dev";
  if (!url || url.origin !== expected || url.username || url.password) throw new Error("Invalid provider authorization link.");
  return url.href;
}

export function createClient(value) {
  const origin = apiOrigin(value);
  const session = sandboxSession();
  const sandbox = !process.env.DISPOSABL_API_KEY && session?.origin === origin;
  async function send(path, options = {}, authenticated) {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error("The request must target the configured API origin.");
    const { timeout = 30_000, signal, ...init } = options;
    const timeoutSignal = AbortSignal.timeout(timeout);
    const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const request = async (refresh = false) => {
      const headers = new Headers(init.headers);
      if (authenticated) {
        const token = sandbox ? session.token : await accessToken(origin, refresh);
        headers.set("Authorization", "Bearer " + token);
      }
      return fetch(url, { ...init, headers, redirect: "error", signal: fetchSignal });
    };
    const response = await request();
    return response.status === 401 && authenticated && !sandbox && !process.env.DISPOSABL_API_KEY
      ? request(true) : response;
  }

  return {
    origin, sandbox,
    signIn: browser => login(origin, browser),
    async currentUser(options) {
      if (!sandbox && !await hasCredentials(origin)) return null;
      try {
        const response = await send("/api/users/current", options, true);
        if (response.status === 401) return null;
        if (!response.ok) throw new Error("Sign-in status is unavailable (HTTP " + response.status + ").");
        return response.json();
      } catch (error) {
        if (error instanceof NotAuthenticated) return null;
        throw error;
      }
    },
    async request(path, options, authenticated = false) {
      const response = await send(path, options, authenticated);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? ("HTTP " + response.status));
      return body;
    },
  };
}
