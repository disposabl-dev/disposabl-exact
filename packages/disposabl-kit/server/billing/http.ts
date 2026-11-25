import type { HttpRouter } from "convex/server";
import { api, internal } from "../../../backend/convex/_generated/api";
import { httpAction } from "../../../backend/convex/_generated/server";
import { isAppRequest, readBody, reply, requestClient, statePattern } from "../requests";

const billing = httpAction(async (ctx, request) => {
  const web = new URL(request.url).pathname.endsWith("/web");
  if (!isAppRequest(request, web)) return reply({ error: "FORBIDDEN" }, 403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return reply({ error: "INVALID_REQUEST" }, 415);
  }
  const body = await readBody(request);
  const operation = body?.operation;
  if (operation !== "status" && !(web && (operation === "checkout" || operation === "portal"))) {
    return reply({ error: "INVALID_REQUEST" }, 400);
  }
  const offer = body?.offer === "monthly" || body?.offer === "topup" ? body.offer : undefined;
  const requestId = typeof body?.requestId === "string" && statePattern.test(body.requestId) ? body.requestId : undefined;
  if (operation === "checkout" && (!offer || !requestId)) return reply({ error: "INVALID_REQUEST" }, 400);

  const client = await requestClient(request, web);
  const userId = await client?.query(api.auth.viewerId, {}).catch(() => null) ?? null;
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
