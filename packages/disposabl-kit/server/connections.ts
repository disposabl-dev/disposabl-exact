import type { HttpRouter } from "convex/server";
import { api, components } from "../../backend/convex/_generated/api";
import { httpAction, type ActionCtx } from "../../backend/convex/_generated/server";
import { siteOrigin } from "./authSettings";
import { privateHeaders, readBody, readRequestText, reply, requestClient } from "./requests";
import type { PlatformSelection } from "./platform";

const consentPath = "/api/mcp/consent";
const credentialsPath = "/api/platform/credentials";
const requestId = /^[a-zA-Z0-9_-]{1,128}$/;

type SessionClient = NonNullable<Awaited<ReturnType<typeof requestClient>>>;
function signedIn(
  handler: (ctx: ActionCtx, request: Request, client: SessionClient) => Promise<Response>,
  form = false,
) {
  return httpAction(async (ctx, request) => {
    const post = request.method === "POST";
    const trustedOrigin = !post || request.headers.get("Origin") === siteOrigin();
    const trustedRequest = form
      ? request.headers.get("Content-Type")?.split(";")[0] === "application/x-www-form-urlencoded"
      : request.headers.get("X-Exact-Auth") === "1";
    if (!trustedOrigin || !trustedRequest) return reply({ error: "FORBIDDEN" }, 403);
    const client = await requestClient(request, true);
    if (!client || !await client.query(api.auth.viewer, {}).catch(() => null)) {
      return reply({ error: "UNAUTHORIZED" }, 401);
    }
    return handler(ctx, request, client);
  });
}

const consent = signedIn(async (ctx, request) => {
  const id = new URL(request.url).searchParams.get("request");
  if (!id || !requestId.test(id)) return reply({ error: "INVALID_REQUEST" }, 400);
  const pending = await ctx.runQuery(components.mcp.oauth.getAuthRequest, { requestId: id });
  if (pending?.kind !== "redirect" || !pending.redirectUri || pending.status !== "pending")
    return reply({ error: "NOT_FOUND" }, 404);
  return reply({ client: pending.clientName || pending.clientId, destination: pending.redirectUri, scopes: pending.scopes });
});

const decide = signedIn(async (_ctx, request, client) => {
  const body = await readRequestText(request);
  if (body === null) return reply({ error: "INVALID_REQUEST" }, 400);
  const form = new URLSearchParams(body);
  const id = form.get("request");
  const decision = form.get("decision");
  if (!id || !requestId.test(id) || (decision !== "approve" && decision !== "deny"))
    return reply({ error: "INVALID_REQUEST" }, 400);
  const result = await client.action(api.mcp.authorize, {
    requestId: id, approve: decision === "approve",
  }).catch(() => null);
  const location = result?.redirectUrl ?? `/consent?request=${encodeURIComponent(id)}&error=1`;
  return new Response(null, { status: 303, headers: { ...privateHeaders, Location: location } });
}, true);

const list = signedIn(async (_ctx, _request, client) => {
  const connections = await client.query(api.mcp.listConnections, {});
  return reply({ connections: connections.map(({ id, name, scopes }) => ({ id, name, scopes })) });
});

const change = signedIn(async (_ctx, request, client) => {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    return reply({ error: "EXPECTED_JSON" }, 415);
  const body = await readBody(request);
  if (body?.operation === "revoke" && typeof body.id === "string" && body.id.length > 0 && body.id.length <= 256) {
    await client.mutation(api.mcp.revokeConnection, { id: body.id });
    return reply({ ok: true });
  }
  if (body?.operation === "create" && typeof body.name === "string" && typeof body.write === "boolean") {
    const name = body.name.trim();
    if (name.length > 0 && name.length <= 100) {
      const { apiKey } = await client.action(api.mcp.createApiKey, {
        name, scopes: body.write ? ["read", "write"] : ["read"],
      });
      return reply({ key: apiKey });
    }
  }
  return reply({ error: "INVALID_REQUEST" }, 400);
});

export function registerConnections(http: HttpRouter, config: Pick<PlatformSelection, "consent" | "credentials">) {
  if (config.consent) {
    http.route({ path: consentPath, method: "GET", handler: consent });
    http.route({ path: consentPath, method: "POST", handler: decide });
  }
  if (config.credentials) {
    http.route({ path: credentialsPath, method: "GET", handler: list });
    http.route({ path: credentialsPath, method: "POST", handler: change });
  }
}
