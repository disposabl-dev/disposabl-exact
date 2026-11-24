import { httpCookies } from "@convex-dev/auth/ssr";
import { ConvexHttpClient } from "convex/browser";
import type { HttpRouter } from "convex/server";
import { api, internal } from "../../backend/convex/_generated/api";
import { env, httpAction } from "../../backend/convex/_generated/server";
import { siteOrigin } from "../../backend/convex/authSettings";
import { authError, cookieName, readBody, readSession, reply, sessionHeader, statePattern } from "./auth";

function isAppRequest(request: Request, web: boolean) {
  const origin = request.headers.get("Origin");
  return request.headers.get("X-Exact-Auth") === "1" && (web ? origin === siteOrigin() : origin === null);
}

const billing = httpAction(async (ctx, request) => {
  const web = new URL(request.url).pathname.endsWith("/web");
  if (!isAppRequest(request, web)) return reply({ error: "FORBIDDEN" }, 403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return reply({ error: "INVALID_REQUEST" }, 415);
  }
  const body = await readBody(request);
  const operation = body?.operation;
  if (operation !== "status" && !(web && (operation === "checkout" || operation === "portal"))) {
    return authError("INVALID_REQUEST");
  }
  const offer = body?.offer === "monthly" || body?.offer === "topup" ? body.offer : undefined;
  const requestId = typeof body?.requestId === "string" && statePattern.test(body.requestId) ? body.requestId : undefined;
  if (operation === "checkout" && (!offer || !requestId)) return authError("INVALID_REQUEST");

  const session = readSession(web ? await httpCookies(request).get(cookieName) : request.headers.get(sessionHeader));
  const userId = session
    ? await new ConvexHttpClient(env.CONVEX_CLOUD_URL, { auth: session.accessToken, logger: false })
      .query(api.billing.index.viewerId, {}).catch(() => null)
    : null;
  if (operation !== "status" && !userId) return reply({ error: "SIGN_IN_REQUIRED" }, 401);
  try {
    const result = await ctx.runAction(internal.billing.index.request, { operation, userId, offer, requestId });
    if ("url" in result && new URL(result.url).protocol !== "https:") throw new Error("Invalid checkout URL");
    return reply(result);
  } catch {
    return reply({ error: "BILLING_UNAVAILABLE" }, 503);
  }
});

export function registerBilling(http: HttpRouter, web: boolean, native: boolean) {
  if (web) http.route({ path: "/api/billing/web", method: "POST", handler: billing });
  if (native) http.route({ path: "/api/billing/native", method: "POST", handler: billing });
}
