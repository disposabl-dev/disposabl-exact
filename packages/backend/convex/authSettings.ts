import { env } from "./_generated/server";

export const ACCESS_TOKEN_SECONDS = 60;
export const GOOGLE_WEB_RETURN = "/.exact/auth/callback";
export const GOOGLE_NATIVE_RETURN = "/api/auth/native-return";
export const GOOGLE_NATIVE_CALLBACK = "dev.disposabl.exact:/oauth/google";
export const siteOrigin = () => new URL(env.CONVEX_SITE_URL).origin;
export const webOrigin = () => env.AUTH_WEB_ORIGIN || siteOrigin();
export const googleEnabled = () => Boolean(
  env.AUTH_GOOGLE_CLIENT_ID?.trim() && env.AUTH_GOOGLE_CLIENT_SECRET?.trim(),
);
