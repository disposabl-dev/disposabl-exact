import type { ConvexHttpClient } from "convex/browser";
import type { HttpRouter } from "convex/server";
import { api, components } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { siteOrigin } from "./authSettings";
import { scopes } from "./mcp";

type WebSession = (
  request: Request,
) => Promise<{ client: ConvexHttpClient; name: string } | null>;

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );
}

function page(title: string, body: string, status = 200, callback?: URL) {
  const destinations = callback
    ? `'self' ${callback.origin === "null" ? callback.protocol : callback.origin}`
    : "'self'";
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><main><h1>${title}</h1>${body}</main></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; form-action ${destinations}; frame-ancestors 'none'; base-uri 'none'`,
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function signIn(title: string, path: string, status = 200) {
  return page(
    title,
    `<p><a href="/" target="_blank" rel="noopener">Sign in to Exact</a>, then return here.</p><p><a href="${escapeHtml(path)}">Continue</a></p>`,
    status,
  );
}

async function readForm(request: Request) {
  if (
    request.headers.get("Origin") !== siteOrigin() ||
    request.headers.get("Content-Type")?.split(";")[0] !==
      "application/x-www-form-urlencoded"
  )
    return null;
  const text = await request.text();
  return text.length <= 4096 ? new URLSearchParams(text) : null;
}

export function registerConsentPage(http: HttpRouter, session: WebSession) {
  const title = "Connect to Disposabl Exact";
  http.route({
    path: "/consent",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const id = new URL(request.url).searchParams.get("request");
      if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
        return page(
          title,
          "<p>Start a new connection from your MCP client.</p>",
          400,
        );
      const account = await session(request);
      if (!account)
        return signIn(title, `/consent?request=${encodeURIComponent(id)}`);
      const pending = await ctx.runQuery(components.mcp.oauth.getAuthRequest, {
        requestId: id,
      });
      if (
        pending?.kind !== "redirect" ||
        !pending.redirectUri ||
        pending.status !== "pending"
      )
        return page(
          title,
          "<p>This request is no longer available. Start a new connection from your MCP client.</p>",
          404,
        );
      const permissions = pending.scopes
        .map(
          (scope) =>
            `<li>${escapeHtml(scopes[scope as keyof typeof scopes] ?? scope)}</li>`,
        )
        .join("");
      return page(
        title,
        `<p>Signed in as <strong>${escapeHtml(account.name)}</strong>.</p>
        <p><strong>${escapeHtml(pending.clientName || pending.clientId)}</strong> requests access. The client provides this name.</p>
        <ul>${permissions}</ul><p>Return to <code>${escapeHtml(pending.redirectUri)}</code></p>
        <form method="post" action="/consent"><input type="hidden" name="request" value="${escapeHtml(id)}">
        <button name="decision" value="deny">Deny</button>
        <button name="decision" value="approve">Allow access</button></form>`,
        200,
        new URL(pending.redirectUri),
      );
    }),
  });
  http.route({
    path: "/consent",
    method: "POST",
    handler: httpAction(async (_ctx, request) => {
      const form = await readForm(request);
      if (!form)
        return page(title, "<p>Open the consent page and try again.</p>", 403);
      const account = await session(request);
      const id = form.get("request");
      const decision = form.get("decision");
      if (
        !id ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
        (decision !== "approve" && decision !== "deny")
      )
        return page(
          title,
          "<p>Start a new connection from your MCP client.</p>",
          400,
        );
      if (!account)
        return signIn(title, `/consent?request=${encodeURIComponent(id)}`, 401);
      try {
        const { redirectUrl } = await account.client.action(api.mcp.authorize, {
          requestId: id,
          approve: decision === "approve",
        });
        if (redirectUrl)
          return new Response(null, {
            status: 303,
            headers: {
              Location: redirectUrl,
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            },
          });
      } catch {
        return page(
          title,
          "<p>This request could not be completed. Start a new connection.</p>",
          400,
        );
      }
      return page(title, "<p>Return to your MCP client.</p>");
    }),
  });
}

export function registerCredentialsPage(http: HttpRouter, session: WebSession) {
  const title = "API keys and connections";
  http.route({
    path: "/api-keys",
    method: "GET",
    handler: httpAction(async (_ctx, request) => {
      const account = await session(request);
      if (!account) return signIn(title, "/api-keys");
      const connections = await account.client.query(
        api.mcp.listConnections,
        {},
      );
      const items = connections
        .map(
          ({ id, name, scopes }) =>
            `<li><form method="post" action="/api-keys"><strong>${escapeHtml(name)}</strong> (${escapeHtml(scopes.join(", "))})
        <button name="revoke" value="${escapeHtml(id)}">Revoke</button></form></li>`,
        )
        .join("");
      return page(
        title,
        `<p>Signed in as <strong>${escapeHtml(account.name)}</strong>.</p>
        <form method="post" action="/api-keys"><label>Key name <input name="name" required maxlength="100"></label>
        <label><input name="write" type="checkbox" value="yes"> Allow changes and actions</label>
        <button>Create key</button></form><ul>${items}</ul>`,
      );
    }),
  });
  http.route({
    path: "/api-keys",
    method: "POST",
    handler: httpAction(async (_ctx, request) => {
      const form = await readForm(request);
      if (!form)
        return page(
          title,
          "<p>Open the credentials page and try again.</p>",
          403,
        );
      const account = await session(request);
      if (!account) return signIn(title, "/api-keys", 401);
      const id = form.get("revoke");
      if (id) {
        await account.client.mutation(api.mcp.revokeConnection, {
          id,
        });
        return new Response(null, {
          status: 303,
          headers: { Location: "/api-keys" },
        });
      }
      const name = form.get("name")?.trim();
      if (!name || name.length > 100)
        return page(
          title,
          '<p>Enter a key name. <a href="/api-keys">Back to credentials</a></p>',
          400,
        );
      const key = await account.client.action(api.mcp.createApiKey, {
        name,
        scopes: form.get("write") === "yes" ? ["read", "write"] : ["read"],
      });
      return page(
        title,
        `<p>Copy this key now. It is shown once.</p><p><code>${escapeHtml(key.apiKey)}</code></p>
        <p><a href="/api-keys">Back to credentials</a></p>`,
      );
    }),
  });
}
