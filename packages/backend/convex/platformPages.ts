import type { ConvexHttpClient } from "convex/browser";
import type { HttpRouter } from "convex/server";
import { api, components } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { siteOrigin } from "./authSettings";

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

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><main><h1>${title}</h1>${body}</main></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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

export function registerConsent(http: HttpRouter, session: WebSession) {
  const endpoint = "/api/mcp/consent";
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const validId = (id: string | null): id is string =>
    id !== null && /^[a-zA-Z0-9_-]{1,128}$/.test(id);

  http.route({
    path: endpoint,
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      if (request.headers.get("X-Exact-Auth") !== "1")
        return new Response(null, { status: 403, headers });
      const id = new URL(request.url).searchParams.get("request");
      if (!validId(id)) return new Response(null, { status: 400, headers });
      const account = await session(request);
      if (!account) return new Response(null, { status: 401, headers });
      const pending = await ctx.runQuery(components.mcp.oauth.getAuthRequest, {
        requestId: id,
      });
      if (
        pending?.kind !== "redirect" ||
        !pending.redirectUri ||
        pending.status !== "pending"
      ) return new Response(null, { status: 404, headers });
      return Response.json({
        client: pending.clientName || pending.clientId,
        destination: pending.redirectUri,
        scopes: pending.scopes,
      }, { headers });
    }),
  });

  http.route({
    path: endpoint,
    method: "POST",
    handler: httpAction(async (_ctx, request) => {
      const form = await readForm(request);
      if (!form) return new Response(null, { status: 403, headers });
      const id = form.get("request");
      const decision = form.get("decision");
      if (!validId(id) || (decision !== "approve" && decision !== "deny"))
        return new Response(null, { status: 400, headers });
      const account = await session(request);
      if (!account) return new Response(null, { status: 401, headers });
      let redirectUrl: string | null | undefined;
      try {
        ({ redirectUrl } = await account.client.action(api.mcp.authorize, {
          requestId: id,
          approve: decision === "approve",
        }));
      } catch {
        // The request can expire or be answered in another tab after review.
      }
      return new Response(null, {
        status: 303,
        headers: {
          ...headers,
          Location: redirectUrl || `/consent?request=${encodeURIComponent(id)}&error=1`,
        },
      });
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
