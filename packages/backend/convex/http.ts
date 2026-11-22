import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { ConvexHttpClient } from "convex/browser";
import { httpRouter } from "convex/server";
import { api, components, internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";
import { GOOGLE_NATIVE_CALLBACK, GOOGLE_NATIVE_RETURN, GOOGLE_WEB_RETURN, googleEnabled, webOrigin } from "./authSettings";

const cookieName = "__Host-exact-session";
const sessionHeader = "X-Exact-Session";
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const statePattern = /^[a-f0-9-]{36}$/;
const tokenPattern = /^[a-zA-Z0-9._-]{1,2048}$/;

type Session = { accessToken: string; refreshToken: string };

function existingSession(request: Request, web: boolean): Session | null {
  const raw = web
    ? request.headers.get("Cookie")?.split(/;\s*/).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    : request.headers.get(sessionHeader);
  const parts = raw?.split("~");
  if (parts?.length !== 2 || !parts.every((part) => tokenPattern.test(part))) return null;
  const [accessToken, refreshToken] = parts;
  return { accessToken, refreshToken };
}

function reply(body: object, status = 200, cookie?: string) {
  const headers = new Headers(privateHeaders);
  if (cookie !== undefined) headers.set("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

function sessionCookie(value: string, maxAge: number) {
  return `${cookieName}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

function authError(error: string) {
  const status = error === "RATE_LIMITED" ? 429
    : error === "GOOGLE_DISABLED" ? 404
      : error === "INVALID_CREDENTIALS" ? 401
        : 400;
  return reply({ error }, status);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  try {
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const data: unknown = JSON.parse(text + decoder.decode());
    return data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function viewer(accessToken: string) {
  const client = new ConvexHttpClient(env.CONVEX_CLOUD_URL, { auth: accessToken, logger: false });
  return client.query(api.auth.viewer, {});
}

function tokenExpired(token: string) {
  // The claim only tells us whether to try refreshing. Convex still verifies
  // the signature and checks that the backing session exists before returning a user.
  try {
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const { exp } = JSON.parse(atob(payload));
    return typeof exp !== "number" || exp * 1000 <= Date.now() + 5000;
  } catch {
    return true;
  }
}

const session = httpAction(async (ctx, request) => {
  const web = new URL(request.url).pathname.endsWith("/web");
  const origin = request.headers.get("Origin");
  // Web mutations require the exact, configured origin and a preflight-only
  // header. No cross-origin or browser-to-native requests are accepted.
  if (request.headers.get("X-Exact-Auth") !== "1" || (web ? origin !== webOrigin() : origin !== null)) {
    return reply({ error: "FORBIDDEN" }, 403);
  }
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return reply({ error: "INVALID_REQUEST" }, 415);
  }
  const body = await readBody(request);
  if (body === null) return authError("INVALID_REQUEST");

  const active = existingSession(request, web);
  const google = googleEnabled();
  const signedOut = () => reply({ viewer: null, google }, 200, web ? sessionCookie("", 0) : undefined);
  const signedIn = async (tokens: Session & { refreshTokenExpiresAt: number }) => {
    const account = await viewer(tokens.accessToken);
    if (account === null) return signedOut();
    const value = `${tokens.accessToken}~${tokens.refreshToken}`;
    const maxAge = Math.max(0, Math.floor((tokens.refreshTokenExpiresAt - Date.now()) / 1000));
    return web
      ? reply({ viewer: account, google }, 200, sessionCookie(value, maxAge))
      : reply({ viewer: account, google, session: value });
  };

  switch (body.operation) {
    case "status": {
      if (!active) return reply({ viewer: null, google });
      if (!tokenExpired(active.accessToken)) {
        const account = await viewer(active.accessToken);
        return account ? reply({ viewer: account, google }) : signedOut();
      }
      const result = await ctx.runMutation(api.auth.refreshSession, { refreshToken: active.refreshToken });
      return result.kind === "rotated" ? signedIn(result.tokens) : signedOut();
    }
    case "signOut": {
      if (active) await ctx.runMutation(api.auth.signOut, { refreshToken: active.refreshToken });
      return signedOut();
    }
    case "password": {
      if (typeof body.create !== "boolean" || typeof body.username !== "string" ||
          typeof body.password !== "string" || body.username.length > 256 || [...body.password].length > 100) {
        return authError("INVALID_REQUEST");
      }
      const result = await ctx.runMutation(internal.auth.passwordSession, {
        create: body.create, username: body.username, password: body.password,
      });
      return result.tokens ? signedIn(result.tokens) : authError(result.error);
    }
    case "googleStart": {
      if (typeof body.callbackState !== "string" || !statePattern.test(body.callbackState)) {
        return authError("INVALID_REQUEST");
      }
      const result = await ctx.runMutation(internal.auth.beginGoogle, { web, callbackState: body.callbackState });
      return "error" in result ? authError(result.error) : reply(result);
    }
    case "googleComplete": {
      if (typeof body.code !== "string" || typeof body.state !== "string" ||
          !tokenPattern.test(body.code) || !tokenPattern.test(body.state)) return authError("INVALID_REQUEST");
      const result = await ctx.runMutation(internal.auth.finishGoogle, { code: body.code, state: body.state });
      return result.tokens ? signedIn(result.tokens) : authError(result.error);
    }
    default:
      return authError("INVALID_REQUEST");
  }
});

const nativeReturn = httpAction(async (_ctx, request) => {
  if (!googleEnabled()) return authError("GOOGLE_DISABLED");
  const params = new URL(request.url).searchParams;
  const [state] = params.getAll("state");
  const [code] = params.getAll("convexAuthCode");
  const [error] = params.getAll("convexAuthError");
  if (!state || params.getAll("state").length !== 1 || !statePattern.test(state) ||
      params.getAll("convexAuthCode").length + params.getAll("convexAuthError").length !== 1 ||
      (code ? !tokenPattern.test(code) : !error)) return authError("INVALID_REQUEST");

  // The native app holds the separate Convex redemption state in memory.
  // Receiving the app link alone does not let another app redeem the ticket.
  const callback = new URL(GOOGLE_NATIVE_CALLBACK);
  callback.searchParams.set("state", state);
  if (code) callback.searchParams.set("convexAuthCode", code);
  else callback.searchParams.set("convexAuthError", "GOOGLE_FAILED");
  return new Response(null, { status: 302, headers: { ...privateHeaders, Location: callback.href } });
});

const webReturn = httpAction(async (ctx) => {
  if (!googleEnabled()) return authError("GOOGLE_DISABLED");
  // The Exact callback is extensionless. Serve its generated HTML with the
  // correct media type and avoid caching a URL that carries a one-time code.
  const asset = await ctx.runQuery(components.staticHosting.lib.resolveAssetForHttp, {
    path: GOOGLE_WEB_RETURN,
    spaFallback: false,
  });
  if (!asset?.storageUrl) return reply({ error: "UNAVAILABLE" }, 503);
  const file = await fetch(asset.storageUrl);
  if (!file.ok || !file.body) return reply({ error: "UNAVAILABLE" }, 503);
  return new Response(file.body, {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

const http = httpRouter();
http.route({ path: "/api/auth/web", method: "POST", handler: session });
http.route({ path: "/api/auth/native", method: "POST", handler: session });
http.route({ path: GOOGLE_NATIVE_RETURN, method: "GET", handler: nativeReturn });
http.route({ path: GOOGLE_WEB_RETURN, method: "GET", handler: webReturn });
registerStaticRoutes(http, components.staticHosting);
export default http;
