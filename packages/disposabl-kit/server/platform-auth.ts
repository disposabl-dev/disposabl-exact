import type { HttpRouter } from "convex/server";
import { api, components } from "../../backend/convex/_generated/api";
import { httpAction } from "../../backend/convex/_generated/server";
import { siteOrigin } from "../../backend/convex/authSettings";
import { platformSession, privateHeaders, readBody, readRequestText, reply } from "./auth";

const requestId = /^[a-zA-Z0-9_-]{1,128}$/;
const credentialsPath = "/api/platform/credentials";

function hasWebHeader(request: Request) {
  return request.headers.get("X-Exact-Auth") === "1";
}

function hasSiteOrigin(request: Request) {
  return request.headers.get("Origin") === siteOrigin();
}

function consentRedirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: { ...privateHeaders, Location: location },
  });
}

export function registerConsent(http: HttpRouter) {
  const path = "/api/mcp/consent";
  http.route({
    path,
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      if (!hasWebHeader(request)) return reply({ error: "FORBIDDEN" }, 403);
      const id = new URL(request.url).searchParams.get("request");
      if (!id || !requestId.test(id)) return reply({ error: "INVALID_REQUEST" }, 400);
      if (!(await platformSession(request))) return reply({ error: "UNAUTHORIZED" }, 401);
      const pending = await ctx.runQuery(components.mcp.oauth.getAuthRequest, { requestId: id });
      if (pending?.kind !== "redirect" || !pending.redirectUri || pending.status !== "pending")
        return reply({ error: "NOT_FOUND" }, 404);
      return reply({
        client: pending.clientName || pending.clientId,
        destination: pending.redirectUri,
        scopes: pending.scopes,
      });
    }),
  });

  http.route({
    path,
    method: "POST",
    handler: httpAction(async (_ctx, request) => {
      if (!hasSiteOrigin(request) ||
          request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded")
        return reply({ error: "FORBIDDEN" }, 403);
      const body = await readRequestText(request);
      if (body === null) return reply({ error: "INVALID_REQUEST" }, 400);
      const form = new URLSearchParams(body);
      const id = form.get("request");
      const decision = form.get("decision");
      if (!id || !requestId.test(id) || (decision !== "approve" && decision !== "deny"))
        return reply({ error: "INVALID_REQUEST" }, 400);
      const client = await platformSession(request);
      if (!client) return reply({ error: "UNAUTHORIZED" }, 401);
      const fallback = `/consent?request=${encodeURIComponent(id)}&error=1`;
      try {
        const result = await client.action(api.mcp.authorize, {
          requestId: id,
          approve: decision === "approve",
        });
        return consentRedirect(result.redirectUrl ?? fallback);
      } catch {
        return consentRedirect(fallback);
      }
    }),
  });
}

export function registerCredentials(http: HttpRouter) {
  http.route({
    path: credentialsPath,
    method: "GET",
    handler: httpAction(async (_ctx, request) => {
      if (!hasWebHeader(request)) return reply({ error: "FORBIDDEN" }, 403);
      const client = await platformSession(request);
      if (!client) return reply({ error: "UNAUTHORIZED" }, 401);
      const connections = await client.query(api.mcp.listConnections, {});
      return reply({ connections: connections.map(({ id, name, scopes }) => ({ id, name, scopes })) });
    }),
  });

  http.route({
    path: credentialsPath,
    method: "POST",
    handler: httpAction(async (_ctx, request) => {
      if (!hasSiteOrigin(request) || !hasWebHeader(request))
        return reply({ error: "FORBIDDEN" }, 403);
      if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
        return reply({ error: "EXPECTED_JSON" }, 415);
      const client = await platformSession(request);
      if (!client) return reply({ error: "UNAUTHORIZED" }, 401);
      const body = await readBody(request);
      if (body?.operation === "revoke" && typeof body.id === "string" &&
          body.id.length > 0 && body.id.length <= 256) {
        await client.mutation(api.mcp.revokeConnection, { id: body.id });
        return reply({ ok: true });
      }
      if (body?.operation === "create" && typeof body.name === "string" &&
          typeof body.write === "boolean") {
        const name = body.name.trim();
        if (name.length > 0 && name.length <= 100) {
          const { apiKey } = await client.action(api.mcp.createApiKey, {
            name,
            scopes: body.write ? ["read", "write"] : ["read"],
          });
          return reply({ key: apiKey });
        }
      }
      return reply({ error: "INVALID_REQUEST" }, 400);
    }),
  });
}
