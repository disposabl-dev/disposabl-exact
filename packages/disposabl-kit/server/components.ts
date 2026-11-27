import { defineApp } from "convex/server";
import { v } from "convex/values";

// Config evaluation decides whether to mount the component before Convex can generate typed env.
export const googleConfigured = Boolean(process.env.AUTH_GOOGLE_CLIENT_ID?.trim() && process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim());
const googleCredential = googleConfigured ? v.string() : v.optional(v.string());
export const app = defineApp({
  env: {
    AUTUMN_SECRET_KEY: v.optional(v.string()),
    DISPOSABL_GITHUB_APP_ID: v.optional(v.string()),
    DISPOSABL_GITHUB_APP_PRIVATE_KEY: v.optional(v.string()),
    DISPOSABL_CONVEX_TEAM_ID: v.optional(v.string()),
    DISPOSABL_CONVEX_TEAM_TOKEN: v.optional(v.string()),
    AUTH_GOOGLE_CLIENT_ID: googleCredential,
    AUTH_GOOGLE_CLIENT_SECRET: googleCredential,
  },
});
