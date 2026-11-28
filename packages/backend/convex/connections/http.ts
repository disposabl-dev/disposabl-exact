import type { HttpRouter } from "convex/server";
import { readRequestText } from "../../../disposabl-kit/server/requests";
import { internal } from "../_generated/api";
import { env, httpAction } from "../_generated/server";
import type { Provider } from "./validators";

const callback = "/dashboard/connections/callback";
const validState = /^[A-Za-z0-9_-]{43}$/;
const validCode = /^[A-Za-z0-9._~-]{1,4096}$/;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

function page(body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect to Disposabl</title></head><body><main>${body}</main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const done = () => page("<h1>Connected</h1><p>You can close this tab and return to Disposabl.</p>");
const failed = () => page("<h1>Connection incomplete</h1><p>Start a new connection from Disposabl and try again.</p>", 400);

function complete(provider: Provider) {
  return httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const code = params.get("code") ?? "";
    const state = params.get("state") ?? "";
    if (!validCode.test(code) || !validState.test(state)) return failed();
    try {
      const result = await ctx.runAction(internal.connections.actions.oauth.complete, { provider, code, state });
      if (result.status === "install") {
        return page(`<h1>Install the GitHub App</h1><p><a href="${escape(result.installUrl)}" target="_blank" rel="noopener noreferrer">Install on GitHub</a></p><p>After installing, <a href="${escape(result.continueUrl)}">continue connecting</a>.</p>`);
      }
      if (result.status === "choose") {
        const choices = result.accounts.map(account => `<button name="installationId" value="${escape(account.installationId)}">${escape(account.owner)}</button>`).join("");
        return page(`<h1>Choose a GitHub account</h1><form method="post" action="${callback}/github"><input name="state" type="hidden" value="${state}">${choices}</form>`);
      }
      return done();
    } catch {
      return failed();
    }
  });
}

const selectGithub = httpAction(async (ctx, request) => {
  if (request.headers.get("Origin") !== new URL(env.CONVEX_SITE_URL).origin) return failed();
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") return failed();
  const form = await readRequestText(request);
  if (form === null || form.length > 1024) return failed();
  const params = new URLSearchParams(form);
  const state = params.get("state") ?? "";
  const installationId = params.get("installationId") ?? "";
  if (!validState.test(state) || !/^[1-9][0-9]{0,19}$/.test(installationId)) return failed();
  try {
    await ctx.runAction(internal.connections.actions.oauth.selectGithub, { state, installationId });
    return done();
  } catch {
    return failed();
  }
});

export function registerProviderConnections(http: HttpRouter) {
  http.route({ path: `${callback}/github`, method: "GET", handler: complete("github") });
  http.route({ path: `${callback}/convex`, method: "GET", handler: complete("convex") });
  http.route({ path: `${callback}/github`, method: "POST", handler: selectGithub });
}
