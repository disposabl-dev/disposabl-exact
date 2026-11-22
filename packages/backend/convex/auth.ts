import { setupGoogle, vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import { setupUsernamePassword } from "@convex-dev/auth/methods/username-password/server";
import { getAuthUserId, setupConvexAuth } from "@convex-dev/auth/server";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import type { RegisteredMutation } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import {
  GOOGLE_NATIVE_RETURN, GOOGLE_WEB_RETURN, googleComponent, googleEnabled, siteOrigin, webOrigin,
} from "./authSettings";

const auth = setupConvexAuth({
  component: components.auth,
  refreshInactivityTimeoutSeconds: 7 * 24 * 60 * 60,
});
export const { refreshSession, signOut } = auth;

const password = setupUsernamePassword(auth, {
  component: components.authPassword,
  usernameComponent: components.authUsername,
}).attachUserCallbacks({ createUser: internal.auth.createPasswordUser });

const google = setupGoogle(auth, {
  component: googleComponent,
  allowedRedirectOrigins: [siteOrigin(), webOrigin()],
}).attachUserCallbacks({ createUser: internal.auth.createGoogleUser });

const limits = new RateLimiter(components.rateLimiter, {
  signup: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 15, shards: 5 },
  googleStart: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 30, shards: 5 },
});

export const createPasswordUser = internalMutation({
  args: { method: v.object({ name: v.literal("usernamePassword"), profile: v.object({}) }) },
  returns: v.id("users"),
  handler: (ctx) => ctx.db.insert("users", {}),
});

export const createGoogleUser = internalMutation({
  args: { method: v.object({ name: v.literal("google"), profile: vGoogleProfile }) },
  returns: v.id("users"),
  handler: (ctx, { method: { profile } }) => ctx.db.insert("users", {
    name: profile.name?.slice(0, 120),
  }),
});

export const viewer = query({
  args: {},
  returns: v.union(v.null(), v.object({ name: v.string() })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    if (user === null) return null;
    const username = await ctx.runQuery(components.authUsername.public.getUsername, { userId });
    return { name: username ?? user.name ?? "Google account" };
  },
});

const authResult = v.union(
  v.object({ tokens: v.object({
    accessToken: v.string(),
    refreshToken: v.string(),
    refreshTokenExpiresAt: v.number(),
    userId: v.string(),
  }) }),
  v.object({ error: v.string() }),
);

function runAuthMethod<Args extends Record<string, unknown>, Result>(
  method: RegisteredMutation<"public", Args, Result>,
  ctx: MutationCtx,
  args: Args,
): Result {
  // The pinned SDK returns registered Convex mutations. Reuse the handlers
  // inside app-validated internal mutations without exposing the SDK endpoints.
  return (method as unknown as { _handler(ctx: MutationCtx, args: Args): Result })._handler(ctx, args);
}

// Keep the SDK handlers behind this HTTP boundary. A direct public export would
// bypass the app's password policy, Google availability, and fixed return paths.
export const passwordSession = internalMutation({
  args: { create: v.boolean(), username: v.string(), password: v.string() },
  returns: authResult,
  handler: async (ctx, { create, username, password: secret }) => {
    const credentials = { username: username.trim(), password: secret };
    if (create) {
      if ([...secret].length < 15) return { error: "PASSWORD_TOO_SHORT" };
      if (!(await limits.limit(ctx, "signup")).ok) return { error: "RATE_LIMITED" };
    }
    const result = create
      ? await runAuthMethod(password.signUpWithUsernamePassword, ctx, credentials)
      : await runAuthMethod(password.signInWithUsernamePassword, ctx, credentials);
    if (result.status === "complete") return { tokens: result.tokens };
    const code = result.userError.error;
    if (code === "RATE_LIMITED") return { error: code };
    return { error: create ? code : "INVALID_CREDENTIALS" };
  },
});

export const beginGoogle = internalMutation({
  args: { web: v.boolean(), callbackState: v.string() },
  returns: v.union(v.object({ redirect: v.string(), state: v.string() }), v.object({ error: v.string() })),
  handler: async (ctx, { web, callbackState }) => {
    if (!googleEnabled()) return { error: "GOOGLE_DISABLED" };
    if (!(await limits.limit(ctx, "googleStart")).ok) return { error: "RATE_LIMITED" };
    const redirect = new URL(web ? GOOGLE_WEB_RETURN : GOOGLE_NATIVE_RETURN, web ? webOrigin() : siteOrigin());
    redirect.searchParams.set("state", callbackState);
    return runAuthMethod(google.startSignInWithGoogle, ctx, { redirectTo: redirect.href });
  },
});

export const finishGoogle = internalMutation({
  args: { code: v.string(), state: v.string() },
  returns: authResult,
  handler: async (ctx, args) => {
    if (!googleEnabled()) return { error: "GOOGLE_DISABLED" };
    const result = await runAuthMethod(google.completeSignInWithGoogle, ctx, args);
    return result.status === "complete" ? { tokens: result.tokens } : { error: result.userError.error };
  },
});
