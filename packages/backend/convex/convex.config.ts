import auth from "@convex-dev/auth/convex.config.js";
import google from "@convex-dev/auth/components/google/convex.config.js";
import password from "@convex-dev/auth/components/password/convex.config.js";
import username from "@convex-dev/auth/components/username/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// Config evaluation decides whether to mount the component before Convex can generate typed env.
// eslint-disable-next-line @convex-dev/no-process-env
const googleConfigured = Boolean(process.env.AUTH_GOOGLE_CLIENT_ID?.trim() && process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim());
const googleCredential = googleConfigured ? v.string() : v.optional(v.string());
const app = defineApp({
  env: {
    AUTH_GOOGLE_CLIENT_ID: googleCredential,
    AUTH_GOOGLE_CLIENT_SECRET: googleCredential,
  },
});
app.use(staticHosting);
app.use(auth);
app.use(password);
app.use(username);
app.use(rateLimiter);
if (googleConfigured) {
  app.use(google, {
    httpPrefix: "/oauth/google",
    env: {
      CLIENT_ID: app.env.AUTH_GOOGLE_CLIENT_ID,
      CLIENT_SECRET: app.env.AUTH_GOOGLE_CLIENT_SECRET,
    },
  });
}

export default app;
