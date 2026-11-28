import type { HttpRouter } from "convex/server";
import { api, components, internal } from "../../backend/convex/_generated/api";
import { httpAction, type ActionCtx } from "../../backend/convex/_generated/server";
import { siteOrigin } from "./authSettings";
import { authClient, privateHeaders, readRequestText } from "./requests";

const requestPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

function page(body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Disposabl sign-in</title><main>${body}</main></html>`, {
    status,
    headers: {
      ...privateHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function pendingRequest(ctx: ActionCtx, requestId: string) {
  if (!requestPattern.test(requestId)) return null;
  const pending = await ctx.runQuery(components.mcp.oauth.getAuthRequest, { requestId });
  return pending?.kind === "redirect" && pending.status === "pending" ? pending : null;
}

function signIn(requestId: string, client: string, scopes: string[], error?: string) {
  return page(`<h1>Sign in to approve access</h1><p>${escape(client)} is requesting ${escape(scopes.join(", "))} access.</p>
    ${error ? "<p>" + escape(error) + "</p>" : ""}
    <form action="/consent" method="post">
      <input type="hidden" name="requestId" value="${requestId}">
      <p><label>Username <input name="username" required maxlength="256" autocomplete="username"></label></p>
      <p><label>Password <input name="password" type="password" required maxlength="100" autocomplete="current-password"></label></p>
      <button name="create" value="false">Sign in and approve</button>
      <button name="create" value="true">Create account and approve</button>
    </form>`, error ? 400 : 200);
}

const invalid = () => page("<h1>Sign-in link expired</h1><p>Run disposabl login again.</p>", 400);

const show = httpAction(async (ctx, request) => {
  const id = new URL(request.url).searchParams.get("request") ?? "";
  const pending = await pendingRequest(ctx, id);
  return pending ? signIn(id, pending.clientName ?? "Disposabl CLI", pending.scopes) : invalid();
});

const approve = httpAction(async (ctx, request) => {
  if (request.headers.get("Origin") !== siteOrigin()) return page("<h1>Request denied</h1>", 403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") return invalid();
  const body = await readRequestText(request);
  if (body === null) return invalid();
  const fields = new URLSearchParams(body);
  const requestId = fields.get("requestId") ?? "";
  const username = fields.get("username") ?? "";
  const password = fields.get("password") ?? "";
  const create = fields.get("create");
  const pending = await pendingRequest(ctx, requestId);
  if (!pending || !username || username.length > 256 || !password || [...password].length > 100 ||
      (create !== "true" && create !== "false")) return invalid();
  const session = await ctx.runMutation(internal.auth.passwordSession, { username, password, create: create === "true" });
  if (!session.tokens) return signIn(requestId, pending.clientName ?? "Disposabl CLI", pending.scopes,
    session.error === "PASSWORD_TOO_SHORT" ? "Use at least 15 characters for a new password." : "Sign-in failed. Check your details and try again.");
  const result = await authClient(session.tokens.accessToken).action(api.mcp.authorize, { requestId, approve: true });
  return result?.redirectUrl
    ? new Response(null, { status: 303, headers: { ...privateHeaders, Location: result.redirectUrl } })
    : invalid();
});

export function registerCliConsent(http: HttpRouter) {
  http.route({ path: "/consent", method: "GET", handler: show });
  http.route({ path: "/consent", method: "POST", handler: approve });
}
