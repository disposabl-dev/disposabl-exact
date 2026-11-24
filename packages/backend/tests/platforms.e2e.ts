import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { project } from "@disposabl-kit/server/project-config";
import { api } from "../convex/_generated/api";
import { mcp as server } from "@disposabl-kit/server/mcp";

const site = process.env.CONVEX_SITE_URL;
const cloud = process.env.CONVEX_URL;
if (
  !site ||
  !cloud ||
  new URL(site).hostname !== "127.0.0.1" ||
  new URL(cloud).hostname !== "127.0.0.1"
) {
  throw new Error(
    "Start an isolated local Convex deployment before running this test.",
  );
}

function mcp(method: string, params?: object, token?: string, origin?: string) {
  return fetch(`${site}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

function form(
  path: string,
  values: Record<string, string>,
  cookie?: string,
  origin = site,
) {
  return fetch(`${site}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: new URLSearchParams(values),
  });
}

function credentials(cookie?: string, body?: object, origin = site) {
  return fetch(`${site}/api/platform/credentials`, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Exact-Auth": "1",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: origin! } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function signIn() {
  const response = await fetch(`${site}/api/auth/web`, {
    method: "POST",
    headers: {
      Origin: site!,
      "X-Exact-Auth": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operation: "password",
      create: true,
      username: `platform-${randomUUID().slice(0, 8)}`,
      password: `test-${randomUUID()}`,
    }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected a signed-in web session.");
  return cookie;
}

async function mcpResult(response: Response) {
  expect(response.status).toBe(200);
  return (await response.json()).result;
}

test("only the selected transports expose the internal counter query", async () => {
  expect(server.lint()).toEqual([]);
  const client = new ConvexHttpClient(cloud);
  const expected = await client.query(api.counter.get, {});
  await expect(
    client.query(makeFunctionReference<"query">("counter:current"), {}),
  ).rejects.toThrow("Could not find public function");
  const endpoint = `${site}/api/counter/current`;
  const response = await fetch(endpoint);
  expect(response.status).toBe(project.api ? 401 : 404);
  const missing = await mcp("tools/list");
  expect(missing.status).toBe(project.mcp ? 401 : 404);
  const openapi = await fetch(`${site}/openapi.json`);
  expect(openapi.status).toBe(project.api ? 200 : 404);
  if (project.api) {
    const spec = await openapi.json();
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.security).toEqual([{ apiKey: [] }]);
    const path = spec.paths["/api/counter/current"];
    expect(path.post).toBeUndefined();
    expect(path.get).toMatchObject({
      operationId: "counter_current",
      description: "Read the current value of the shared demo counter.",
      parameters: [],
      "x-required-scope": "read",
      responses: { "200": { content: { "application/json": { schema: {
        type: "object",
        required: ["count"],
      } } } } },
    });
    expect(spec.paths["/api/platform/credentials"]).toBeUndefined();
  }
  if (!project.credentials) {
    expect((await credentials()).status).toBe(404);
    return;
  }

  const cookie = await signIn();
  expect((await credentials()).status).toBe(401);
  expect((await credentials(cookie, { operation: "create", name: "Disallowed", write: false }, "https://example.com")).status).toBe(403);
  const issued = await credentials(cookie, { operation: "create", name: "Local integration key", write: false });
  expect(issued.status).toBe(200);
  expect(issued.headers.get("Cache-Control")).toBe("no-store");
  const { key } = await issued.json();
  expect(typeof key).toBe("string");
  const headers = { Authorization: `Bearer ${key}` };
  if (project.api) {
    const allowed = await fetch(endpoint, { headers });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(expected);
    const wrongMethod = await fetch(endpoint, {
      method: "POST",
      headers,
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("GET");
    expect(
      (await fetch(`${endpoint}?userId=someone-else`, { headers })).status,
    ).toBe(400);
  }

  if (project.mcp) {
    const { tools } = await mcpResult(await mcp("tools/list", undefined, key));
    expect(tools.find((tool: { name: string }) => tool.name === "counter_current")).toMatchObject({
      name: "counter_current",
      description: "Read the current value of the shared demo counter.",
      inputSchema: { properties: {} },
      annotations: { readOnlyHint: true },
    });
    const result = await mcpResult(
      await mcp("tools/call", { name: "counter_current" }, key),
    );
    expect(result.structuredContent).toEqual(expected);
    expect(
      (await mcp("tools/list", undefined, key, "https://example.com")).status,
    ).toBe(403);
  }

  const listed = await credentials(cookie);
  const { connections } = await listed.json();
  expect(connections).toMatchObject([{ name: "Local integration key", scopes: ["read"] }]);
  expect(JSON.stringify(connections)).not.toContain(key);
  const grant = connections[0].id;
  expect((await credentials(cookie, { operation: "revoke", id: grant })).status).toBe(200);
  expect(await (await credentials(cookie)).json()).toEqual({ connections: [] });
  if (project.api)
    expect((await fetch(endpoint, { headers })).status).toBe(401);
  if (project.mcp)
    expect((await mcp("tools/list", undefined, key)).status).toBe(401);
});

test.skipIf(project.credentials || (!project.api && !project.mcp))(
  "headless transports accept a scoped operator key without app authentication",
  async () => {
    async function run(name: string, args: object) {
      const command = Bun.spawn(["bun", "run", "convex", "run", name, JSON.stringify(args)], {
        stdout: "pipe", stderr: "pipe",
      });
      const json = await new Response(command.stdout).text();
      if (await command.exited !== 0) throw new Error(`Local operator command failed: ${name}`);
      return json.trim() ? JSON.parse(json) : null;
    }
    const name = "Headless verification";
    const userId = await run("mcp:createServiceUser", { name });
    const { id, apiKey } = await run("mcp:createApiKeyForUser", { userId, name, scopes: ["read"] });
    const headers = { Authorization: `Bearer ${apiKey}` };
    const endpoint = `${site}/api/counter/current`;
    try {
      expect((await fetch(endpoint, { headers })).status).toBe(project.api ? 200 : 404);
      const result = await mcp("tools/list", undefined, apiKey);
      expect(result.status).toBe(project.mcp ? 200 : 404);
      if (project.mcp) expect((await result.json()).result.tools[0].name).toBe("counter_current");
      expect((await fetch(`${site}/.well-known/oauth-authorization-server`)).status).toBe(404);
      expect((await fetch(`${site}/api-keys`)).status).toBe(404);
    } finally {
      await run("mcp:revokeServiceKey", { id, userId });
    }
    if (project.api) expect((await fetch(endpoint, { headers })).status).toBe(401);
    if (project.mcp) expect((await mcp("tools/list", undefined, apiKey)).status).toBe(401);
  },
);

test.skipIf(!project.consent)(
  "MCP issues a scoped token after signed-in PKCE consent",
  async () => {
    const challenge = await mcp("tools/list");
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${site}/.well-known/oauth-protected-resource/mcp"`,
    );
    const metadata = await fetch(
      `${site}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(await metadata.json()).toMatchObject({ resource: `${site}/mcp` });

    const redirectUri = "http://127.0.0.1:32145/callback";
    const registration = await fetch(`${site}/mcp/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Exact integration client",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(registration.status).toBe(201);
    const clientId = (await registration.json()).client_id;
    const verifier =
      randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "read",
      state: "test-state",
      resource: `${site}/mcp`,
    });
    const start = await fetch(`${site}/mcp/oauth/authorize?${params}`, {
      redirect: "manual",
    });
    const consent = new URL(start.headers.get("Location")!);
    expect(consent.pathname).toBe("/consent");
    const request = consent.searchParams.get("request")!;
    const details = `${site}/api/mcp/consent?request=${encodeURIComponent(request)}`;
    expect((await fetch(details)).status).toBe(403);
    expect((await fetch(details, { headers: { "X-Exact-Auth": "1" } })).status).toBe(401);
    expect(
      (await form("/api/mcp/consent", { request, decision: "approve" })).status,
    ).toBe(401);

    const cookie = await signIn();
    expect((await fetch(details, { headers: { Cookie: cookie } })).status).toBe(403);
    const pending = await fetch(details, { headers: { Cookie: cookie, "X-Exact-Auth": "1" } });
    expect(pending.status).toBe(200);
    expect(pending.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await pending.json()).toMatchObject({
      client: "Exact integration client",
      destination: redirectUri,
      scopes: ["read"],
    });
    expect(
      (
        await form(
          "/api/mcp/consent",
          { request, decision: "approve" },
          cookie,
          "https://example.com",
        )
      ).status,
    ).toBe(403);
    const approval = await form(
      "/api/mcp/consent",
      { request, decision: "approve" },
      cookie,
    );
    expect(approval.status).toBe(303);
    const callback = new URL(approval.headers.get("Location")!);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("test-state");

    const exchange = {
      grant_type: "authorization_code",
      client_id: clientId,
      code: callback.searchParams.get("code")!,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: `${site}/mcp`,
    };
    const token = await form("/mcp/oauth/token", exchange);
    expect(token.status).toBe(200);
    const grant = await token.json();
    expect(grant.scope).toBe("read");
    const result = await mcpResult(
      await mcp("tools/call", { name: "counter_current" }, grant.access_token),
    );
    expect(result.structuredContent).toHaveProperty("count");
    expect((await form("/mcp/oauth/token", exchange)).status).toBe(400);
    if (project.api) {
      expect(
        (
          await fetch(`${site}/api/counter/current`, {
            headers: { Authorization: `Bearer ${grant.access_token}` },
          })
        ).status,
      ).toBe(401);
    }
  },
);
