import type { SandboxAuthorization } from "../../../disposabl-kit/server/rest";
import { reply } from "../../../disposabl-kit/server/requests";
import type { HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { httpAction, type ActionCtx } from "../_generated/server";

const connectionOperations = new Set([
  "connections/internal:status",
  "connections/github/internal:status",
  "connections/github/internal:connect",
  "connections/convex/internal:status",
  "connections/convex/internal:connect",
]);

async function session(ctx: ActionCtx, request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (dsp_sandbox_[a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return ctx.runQuery(internal.agent.internal.getSandboxSession, { tokenHash });
}

export const authorizeSandbox: SandboxAuthorization = async (ctx, request) => {
  const sandbox = await session(ctx, request);
  if (!sandbox) return null;
  const { userId, appSlug, threadId, turnId } = sandbox;
  return {
    userId,
    allows: (operation, args) => {
      if (connectionOperations.has(operation.id)) return true;
      if (typeof args.appSlug !== "string") return false;
      if (operation.id === "apps/internal:get") return args.appSlug === appSlug;
      if (operation.id !== "apps/internal:create") return false;
      return ctx.runMutation(internal.agent.internal.claimApp, { turnId, appSlug: args.appSlug });
    },
    onSuccess: async (operation, args) => {
      if (operation.id === "apps/internal:create" && typeof args.appSlug === "string") {
        await ctx.runMutation(internal.agent.internal.linkApp, { userId, appSlug: args.appSlug, threadId });
      }
    },
  };
};

const gitToken = httpAction(async (ctx, request) => {
  const sandbox = await session(ctx, request);
  if (!sandbox) return reply({ error: "Sandbox session expired." }, 401);
  if (!sandbox.appSlug) return reply({ error: "Create an app before requesting workspace access." }, 409);
  const args = { userId: sandbox.userId, appSlug: sandbox.appSlug };
  try {
    const result = await ctx.runAction(internal.agent.actions.credentials.github, args);
    return reply(result);
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string") return reply({ error: error.data }, 400);
    return reply({ error: "GitHub access is unavailable. Check the app's connection." }, 502);
  }
});

const convexKey = httpAction(async (ctx, request) => {
  const sandbox = await session(ctx, request);
  if (!sandbox) return reply({ error: "Sandbox session expired." }, 401);
  if (!sandbox.appSlug) return reply({ error: "Create an app before requesting workspace access." }, 409);
  const args = { userId: sandbox.userId, appSlug: sandbox.appSlug };
  try {
    const result = await ctx.runAction(internal.agent.actions.credentials.convex, args);
    return reply(result);
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string") return reply({ error: error.data }, 400);
    return reply({ error: "Convex preview access is unavailable. Check the app's connection." }, 502);
  }
});

export function registerSandboxRoutes(http: HttpRouter) {
  http.route({ path: "/api/sandbox/github", method: "POST", handler: gitToken });
  http.route({ path: "/api/sandbox/convex", method: "POST", handler: convexKey });
}
