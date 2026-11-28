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
  return ctx.runQuery(internal.agent.internal.getSandboxSession, { tokenHash, now: Date.now() });
}

export const authorizeSandbox: SandboxAuthorization = async (ctx, request) => {
  const sandbox = await session(ctx, request);
  if (!sandbox) return null;
  const { userId, appSlug, threadId, sandbox: box, messageId } = sandbox;
  return {
    userId,
    allows: (operation, args) => {
      if (connectionOperations.has(operation.id)) return true;
      if (operation.id === "apps/internal:get") {
        if (!appSlug) return false;
        if (typeof args.appId !== "string") return args.appSlug === appSlug;
        return ctx.runQuery(internal.apps.internal.get, { userId, appSlug }).then(app => app?.appId === args.appId);
      }
      if (typeof args.appSlug !== "string") return false;
      if (operation.id !== "apps/internal:create") return false;
      return ctx.runMutation(internal.agent.internal.claimApp, { sandbox: box, messageId, appSlug: args.appSlug });
    },
    onSuccess: async (operation, args) => {
      if (operation.id === "apps/internal:create" && typeof args.appSlug === "string") {
        await ctx.runMutation(internal.agent.internal.linkApp, { userId, appSlug: args.appSlug, threadId });
      }
    },
  };
};

function workspaceCredential(provider: "github" | "convex") {
  return httpAction(async (ctx, request) => {
    const sandbox = await session(ctx, request);
    if (!sandbox) return reply({ error: "Sandbox session expired." }, 401);
    if (!sandbox.appSlug) return reply({ error: "Create an app before requesting workspace access." }, 409);
    const args = { userId: sandbox.userId, appSlug: sandbox.appSlug };
    try {
      const action = internal.agent.actions.credentials;
      return reply(provider === "github" ? await ctx.runAction(action.github, args) : await ctx.runAction(action.convex, args));
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === "string") return reply({ error: error.data }, 400);
      return reply({ error: "Workspace access is unavailable. Check the app's connection." }, 502);
    }
  });
}

export function registerSandboxRoutes(http: HttpRouter) {
  for (const provider of ["github", "convex"] as const) {
    http.route({ path: `/api/sandbox/${provider}`, method: "POST", handler: workspaceCredential(provider) });
  }
}
