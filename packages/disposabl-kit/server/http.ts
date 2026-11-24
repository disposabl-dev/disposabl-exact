import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import config from "../../../disposabl.json";
import { components } from "../../backend/convex/_generated/api";
import { httpAction } from "../../backend/convex/_generated/server";
import { siteOrigin } from "../../backend/convex/authSettings";
import { registerApi } from "./api";
import { registerAuth, reply, serveWebDocument } from "./auth";
import { mcp, platformOperations, service } from "./mcp";
import { createOpenApi } from "./openapi";
import { registerConsent, registerCredentials } from "./platform-auth";

// The Exact web app renders these routes. Keep its authorization controls out of frames.
const exactDocument = httpAction((ctx) =>
  // Preserve Origin on the browser's consent form submission.
  serveWebDocument(ctx, "/index.html", "frame-ancestors 'none'", "same-origin"),
);

const notFound = httpAction(async () => reply({ error: "NOT_FOUND" }, 404));

export function createHttp() {
  const http = httpRouter();
  const platforms: readonly string[] = config.platforms;
  const apiEnabled = platforms.includes("api");
  const mcpEnabled = platforms.includes("mcp");

  registerAuth(http);
  if (apiEnabled) {
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
  }
  if (mcpEnabled) {
    mcp.registerRoutes(http);
    registerConsent(http);
  } else {
    http.route({ path: "/mcp", method: "GET", handler: notFound });
  }
  if (apiEnabled || mcpEnabled) registerCredentials(http);

  http.route({ path: "/consent", method: "GET", handler: mcpEnabled ? exactDocument : notFound });
  http.route({ path: "/api-keys", method: "GET", handler: apiEnabled || mcpEnabled ? exactDocument : notFound });
  // The web shell must not handle missing or disabled API endpoints.
  http.route({ pathPrefix: "/api/", method: "GET", handler: notFound });
  http.route({ pathPrefix: "/mcp/", method: "GET", handler: notFound });
  registerStaticRoutes(http, components.staticHosting);
  return http;
}
