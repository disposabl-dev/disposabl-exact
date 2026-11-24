import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { project } from "../../../scripts/project-config.mjs";
import { components } from "../../backend/convex/_generated/api";
import { httpAction } from "../../backend/convex/_generated/server";
import { siteOrigin } from "../../backend/convex/authSettings";
import { registerApi } from "./api";
import { registerBilling } from "./billing";
import { registerAuth, reply } from "./auth";
import { mcp, platformOperations, service } from "./mcp";
import { createOpenApi } from "./openapi";
import { registerConsent, registerCredentials } from "./platform-auth";

const notFound = httpAction(async () => reply({ error: "NOT_FOUND" }, 404));

export function createHttp(config = project) {
  const http = httpRouter();
  http.route({
    path: "/api/disposabl/config",
    method: "GET",
    handler: httpAction(async () => reply({
      authentication: config.authentication,
      payments: config.payments,
      credentials: config.credentials,
      consent: config.consent,
    })),
  });

  if (config.authentication) registerAuth(http, config.web, config.native);
  if (config.payments) registerBilling(http, config.web, config.native);
  if (config.api) {
    registerApi(http, platformOperations, mcp.authenticate.bind(mcp));
    const { title, version } = service;
    const spec = createOpenApi(platformOperations, { title, version }, siteOrigin());
    http.route({
      path: "/openapi.json",
      method: "GET",
      handler: httpAction(async () => Response.json(spec, {
        headers: { "Cache-Control": "no-cache" },
      })),
    });
  } else {
    http.route({ path: "/openapi.json", method: "GET", handler: notFound });
  }
  if (config.consent) {
    mcp.registerRoutes(http);
    registerConsent(http);
  } else {
    if (config.mcp) {
      http.route({ path: "/mcp", method: "POST", handler: httpAction((ctx, request) => mcp.handleMcp(ctx, request)) });
    }
    http.route({ path: "/mcp", method: "GET", handler: notFound });
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
    ]) http.route({ path, method: "GET", handler: notFound });
  }
  if (config.credentials) registerCredentials(http);

  if (!config.consent) http.route({ path: "/consent", method: "GET", handler: notFound });
  if (!config.credentials) http.route({ path: "/api-keys", method: "GET", handler: notFound });
  // Disabled endpoints must not resolve to the static host's SPA fallback.
  http.route({ pathPrefix: "/api/", method: "GET", handler: notFound });
  http.route({ pathPrefix: "/mcp/", method: "GET", handler: notFound });
  http.route({ pathPrefix: "/api/", method: "POST", handler: notFound });
  http.route({ pathPrefix: "/mcp/", method: "POST", handler: notFound });
  if (!config.payments) http.route({ path: "/pricing", method: "GET", handler: notFound });
  if (!config.authentication || !config.web) {
    http.route({ path: "/.exact/auth/callback", method: "GET", handler: notFound });
  }
  if (config.web) registerStaticRoutes(http, components.staticHosting);
  return http;
}
