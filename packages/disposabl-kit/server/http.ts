import { httpCookies, isTokenExpiring, type TokenBundle } from "@convex-dev/auth/ssr";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { platform, type PlatformSelection } from "./platform";
import { registerConnections } from "./connections";
import { registerBilling } from "./billing/http";
import { authClient, cookieName, isAppRequest, privateHeaders, readBody, readSession, reply, sessionHeader, statePattern, tokenPattern } from "./requests";
import { api, components, internal } from "../../backend/convex/_generated/api";
import { httpAction } from "../../backend/convex/_generated/server";
import { mcp } from "./mcp";
import { registerAppOperations, registerRest } from "./rest";
import { GOOGLE_NATIVE_CALLBACK, GOOGLE_NATIVE_RETURN, GOOGLE_WEB_RETURN, googleAvailable, googleEnabled } from "./authSettings";

const cookieOptions = { path: "/", secure: true, httpOnly: true, sameSite: "strict" } as const;

function authError(error: string) {
  const status = error === "RATE_LIMITED" ? 429
    : error === "GOOGLE_DISABLED" ? 404
      : error === "INVALID_CREDENTIALS" ? 401
        : 400;
  return reply({ error }, status);
}

function viewer(accessToken: string) {
  return authClient(accessToken).query(api.auth.viewer, {});
}

const session = httpAction(async (ctx, request) => {
  const web = new URL(request.url).pathname.endsWith("/web");
  // Web mutations require the exact, configured origin and a preflight-only
  // header. No cross-origin or browser-to-native requests are accepted.
  if (!isAppRequest(request, web)) {
    return reply({ error: "FORBIDDEN" }, 403);
  }
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return reply({ error: "INVALID_REQUEST" }, 415);
  }
  const body = await readBody(request);
  if (body === null) return authError("INVALID_REQUEST");

  const cookies = web ? httpCookies(request) : undefined;
  const active = readSession(cookies ? await cookies.get(cookieName) : request.headers.get(sessionHeader));
  const google = await googleAvailable();
  const signedOut = async () => {
    // __Host- cookies also require Secure when they are expired.
    await cookies?.set(cookieName, "", { ...cookieOptions, maxAge: 0 });
    return reply({ viewer: null, google }, 200, cookies);
  };
  const signedIn = async (tokens: TokenBundle) => {
    const account = await viewer(tokens.accessToken);
    if (account === null) return signedOut();
    const value = `${tokens.accessToken}~${tokens.refreshToken}`;
    if (!cookies) return reply({ viewer: account, google, session: value });
    await cookies.set(cookieName, value, { ...cookieOptions, expires: new Date(tokens.refreshTokenExpiresAt) });
    return reply({ viewer: account, google }, 200, cookies);
  };

  switch (body.operation) {
    case "status": {
      if (!active) return reply({ viewer: null, google });
      if (!isTokenExpiring(active.accessToken)) {
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
      if (!google) return authError("GOOGLE_DISABLED");
      if (typeof body.callbackState !== "string" || !statePattern.test(body.callbackState)) {
        return authError("INVALID_REQUEST");
      }
      const result = await ctx.runMutation(internal.auth.beginGoogle, { web, callbackState: body.callbackState });
      return "error" in result ? authError(result.error) : reply(result);
    }
    case "googleComplete": {
      if (!google) return authError("GOOGLE_DISABLED");
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
  const states = params.getAll("state");
  const codes = params.getAll("convexAuthCode");
  const errors = params.getAll("convexAuthError");
  const [state] = states;
  const [code] = codes;
  if (states.length !== 1 || !statePattern.test(state) || codes.length + errors.length !== 1 ||
      (code ? !tokenPattern.test(code) : !errors[0])) return authError("INVALID_REQUEST");

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

const notFound = httpAction(async () => reply({ error: "NOT_FOUND" }, 404));

export function createHttp(config: PlatformSelection = platform) {
  const http = httpRouter();
  if (config.authentication && config.web) {
    http.route({ path: "/api/auth/web", method: "POST", handler: session });
    http.route({ path: GOOGLE_WEB_RETURN, method: "GET", handler: webReturn });
  }
  if (config.authentication && config.native) {
    http.route({ path: "/api/auth/native", method: "POST", handler: session });
    http.route({ path: GOOGLE_NATIVE_RETURN, method: "GET", handler: nativeReturn });
  }
  if (config.payments) registerBilling(http, config.web, config.native);
  if (config.authentication) registerAppOperations(http, config.web, config.native);
  if (config.api) registerRest(http);
  else http.route({ path: "/openapi.json", method: "GET", handler: notFound });
  if (config.consent) {
    mcp.registerRoutes(http);
  } else {
    if (config.mcp) {
      http.route({ path: "/mcp", method: "POST", handler: httpAction(async (ctx, request) => {
        const response = await mcp.handleMcp(ctx, request);
        if (response.status === 401) response.headers.set("WWW-Authenticate", "Bearer");
        return response;
      }) });
    }
    http.route({ path: "/mcp", method: "GET", handler: notFound });
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
    ]) http.route({ path, method: "GET", handler: notFound });
  }
  registerConnections(http, config);

  if (!config.consent) http.route({ path: "/consent", method: "GET", handler: notFound });
  // Disabled endpoints must not resolve to the static host's SPA fallback.
  http.route({ pathPrefix: "/api/", method: "GET", handler: notFound });
  http.route({ pathPrefix: "/mcp/", method: "GET", handler: notFound });
  for (const [previous, path, enabled] of [
    ["/api-keys", "/dashboard/api-keys", config.credentials],
    ["/pricing", "/dashboard/billing", config.web && config.payments],
  ] as const) {
    const handler = enabled ? httpAction(async (_ctx, request) => new Response(null, {
      status: 302,
      headers: { ...privateHeaders, Location: path + new URL(request.url).search },
    })) : notFound;
    http.route({ path: previous, method: "GET", handler });
    if (!enabled) http.route({ path, method: "GET", handler: notFound });
  }
  if (!config.authentication || !config.frontend) {
    http.route({ pathPrefix: "/oauth/google/", method: "GET", handler: notFound });
  }
  if (!config.authentication || !config.web) {
    http.route({ path: "/.exact/auth/callback", method: "GET", handler: notFound });
  }
  if (config.web) registerStaticRoutes(http, components.staticHosting);
  return http;
}

export default createHttp();
