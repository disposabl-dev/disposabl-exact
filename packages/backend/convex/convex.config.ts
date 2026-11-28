import agent from "@convex-dev/agent/convex.config.js";
import auth from "@convex-dev/auth/convex.config.js";
import google from "@convex-dev/auth/components/google/convex.config.js";
import password from "@convex-dev/auth/components/password/convex.config.js";
import username from "@convex-dev/auth/components/username/convex.config.js";
import mcp from "@convex-dev/mcp/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";
import { platform } from "@disposabl-kit/server/platforms.ts";
import { environment, googleConfigured } from "@disposabl-kit/server/components.ts";

const app = defineApp({
  env: {
    ...environment,
    BOAT_API_KEY: v.optional(v.string()),
    BOAT_AGENT_ENVIRONMENT: v.optional(v.string()),
    BOAT_AGENT_MODEL: v.optional(v.string()),
    BOAT_AGENT_SNAPSHOT: v.optional(v.string()),
    BOAT_AGENT_SNAPSHOTS: v.optional(v.string()),
  },
});

app.use(staticHosting);
app.use(auth);
app.use(password);
app.use(username);
app.use(rateLimiter);
app.use(mcp);
app.use(agent);
if (googleConfigured) {
  app.use(google, {
    // Keep linked Google accounts when authentication is temporarily disabled.
    httpPrefix: platform.authentication && platform.frontend ? "/oauth/google" : undefined,
    env: {
      CLIENT_ID: app.env.AUTH_GOOGLE_CLIENT_ID,
      CLIENT_SECRET: app.env.AUTH_GOOGLE_CLIENT_SECRET,
    },
  });
}

export default app;
