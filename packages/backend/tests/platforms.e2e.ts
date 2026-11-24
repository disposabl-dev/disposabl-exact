import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { mcp as server } from "@disposabl-kit/server/mcp";
import { appPlatform as platform } from "../app-platform";
import { api } from "../convex/_generated/api";

const site = process.env.CONVEX_SITE_URL;
const cloud = process.env.CONVEX_URL;
if (!site || !cloud || new URL(site).hostname !== "127.0.0.1" || new URL(cloud).hostname !== "127.0.0.1") {
  throw new Error("Start an isolated local Convex deployment before running this test.");
}

const counter = "/api/counter/current";
const credentials = "/api/platform/credentials";
const consentPath = "/api/mcp/consent";
const tool = "counter_current";
const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
const web = (cookie?: string, origin = site!) => ({ "X-Exact-Auth": "1", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) });
const request = (path: string, init?: RequestInit) => fetch(site + path, { redirect: "manual", ...init });

function post(path: string, body: object, headers?: Record<string, string>) {
  return body instanceof URLSearchParams
    ? request(path, { method: "POST", body, headers })
    : request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
}

function mcp(method: string, key?: string, params?: object, origin?: string) {
  return post("/mcp", { jsonrpc: "2.0", id: 1, method, params }, {
    Accept: "application/json, text/event-stream",
    ...(key && bearer(key)),
    ...(origin && { Origin: origin }),
  });
}

async function json(response: Response, status = 200) {
  expect(response.status).toBe(status);
  return response.json();
}

async function signIn() {
  const response = await post("/api/auth/web", {
    operation: "password",
    create: true,
    username: `platform-${randomUUID().slice(0, 8)}`,
    password: `test-${randomUUID()}`,
  }, web());
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected a signed-in web session");
  return cookie;
}

test("only the selected transports expose the internal counter", async () => {
  expect(server.lint()).toEqual([]);
  const client = new ConvexHttpClient(cloud);
  const expected = await client.query(api.counter.get, {});
  await expect(client.query(makeFunctionReference<"query">("counter:current"), {}))
    .rejects.toThrow("Could not find public function");
  expect((await request(counter)).status).toBe(platform.api ? 401 : 404);
  expect((await mcp("tools/list")).status).toBe(platform.mcp ? 401 : 404);
  const openapi = await request("/openapi.json");
  expect(openapi.status).toBe(platform.api ? 200 : 404);
  if (platform.api) {
    const spec = await openapi.json();
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.security).toEqual([{ apiKey: [] }]);
    expect(spec.paths[counter].post).toBeUndefined();
    expect(spec.paths[counter].get).toMatchObject({
      operationId: tool,
      description: "Read the current value of the shared demo counter.",
      parameters: [],
      "x-required-scope": "read",
      responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["count"] } } } } },
    });
    expect(spec.paths[credentials]).toBeUndefined();
  }

  expect((await request(credentials, { headers: web() })).status).toBe(platform.credentials ? 401 : 404);
  if (!platform.credentials) return;

  const cookie = await signIn();
  const headers = web(cookie);
  const create = { operation: "create", name: "Local integration key", write: false };
  expect((await post(credentials, create, web(cookie, "https://example.com"))).status).toBe(403);
  const issued = await post(credentials, create, headers);
  expect(issued.headers.get("Cache-Control")).toBe("no-store");
  const { key } = await json(issued);
  expect(typeof key).toBe("string");

  if (platform.api) {
    expect(await json(await request(counter, { headers: bearer(key) }))).toEqual(expected);
    const wrongMethod = await post(counter, {}, bearer(key));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("GET");
    expect((await request(`${counter}?userId=someone-else`, { headers: bearer(key) })).status).toBe(400);
  }
  if (platform.mcp) {
    const listed = await json(await mcp("tools/list", key));
    expect(listed.result.tools).toContainEqual(expect.objectContaining({
      name: tool,
      description: "Read the current value of the shared demo counter.",
      inputSchema: expect.objectContaining({ properties: {} }),
      annotations: { readOnlyHint: true },
    }));
    const called = await json(await mcp("tools/call", key, { name: tool }));
    expect(called.result.structuredContent).toEqual(expected);
    expect((await mcp("tools/list", key, undefined, "https://example.com")).status).toBe(403);
  }

  const { connections } = await json(await request(credentials, { headers }));
  expect(connections).toMatchObject([{ name: create.name, scopes: ["read"] }]);
  expect(JSON.stringify(connections)).not.toContain(key);
  await json(await post(credentials, { operation: "revoke", id: connections[0].id }, headers));
  expect(await json(await request(credentials, { headers }))).toEqual({ connections: [] });
  if (platform.api) expect((await request(counter, { headers: bearer(key) })).status).toBe(401);
  if (platform.mcp) expect((await mcp("tools/list", key)).status).toBe(401);
});

test.skipIf(platform.credentials || (!platform.api && !platform.mcp))("headless transports accept a scoped operator key", async () => {
  async function run(name: string, args: object) {
    const command = Bun.spawn(["bun", "run", "convex", "run", name, JSON.stringify(args)], {
      stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(command.stdout).text();
    expect(await command.exited).toBe(0);
    return output.trim() ? JSON.parse(output) : null;
  }
  const name = "Headless verification";
  const userId = await run("mcp:createServiceUser", { name });
  const { id, apiKey } = await run("mcp:createApiKeyForUser", { userId, name, scopes: ["read"] });
  try {
    expect((await request(counter, { headers: bearer(apiKey) })).status).toBe(platform.api ? 200 : 404);
    const listed = await mcp("tools/list", apiKey);
    expect(listed.status).toBe(platform.mcp ? 200 : 404);
    if (platform.mcp) expect((await listed.json()).result.tools[0].name).toBe(tool);
    expect((await request("/.well-known/oauth-authorization-server")).status).toBe(404);
    expect((await request("/api-keys")).status).toBe(404);
  } finally {
    await run("mcp:revokeServiceKey", { id, userId });
  }
  if (platform.api) expect((await request(counter, { headers: bearer(apiKey) })).status).toBe(401);
  if (platform.mcp) expect((await mcp("tools/list", apiKey)).status).toBe(401);
});

test.skipIf(!platform.consent)("MCP issues a scoped token after signed-in PKCE consent", async () => {
  const metadata = "/.well-known/oauth-protected-resource/mcp";
  const challenge = await mcp("tools/list");
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get("WWW-Authenticate")).toContain(`resource_metadata="${site}${metadata}"`);
  expect(await json(await request(metadata))).toMatchObject({ resource: `${site}/mcp` });

  const redirectUri = "http://127.0.0.1:32145/callback";
  const clientName = "Exact integration client";
  const client = await json(await post("/mcp/oauth/register", {
    client_name: clientName, redirect_uris: [redirectUri], token_endpoint_auth_method: "none",
  }), 201);
  const verifier = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const options = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "read",
    state: "test-state",
    resource: `${site}/mcp`,
  });
  const start = await request(`/mcp/oauth/authorize?${options}`);
  const consent = new URL(start.headers.get("Location")!);
  expect(consent.pathname).toBe("/consent");
  const id = consent.searchParams.get("request")!;
  const details = `${consentPath}?${new URLSearchParams({ request: id })}`;
  const decision = new URLSearchParams({ request: id, decision: "approve" });
  expect((await request(details)).status).toBe(403);
  expect((await request(details, { headers: web() })).status).toBe(401);
  expect((await post(consentPath, decision, web())).status).toBe(401);

  const cookie = await signIn();
  expect((await request(details, { headers: { Cookie: cookie } })).status).toBe(403);
  const pending = await request(details, { headers: web(cookie) });
  expect(pending.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(await json(pending)).toMatchObject({ client: clientName, destination: redirectUri, scopes: ["read"] });
  expect((await post(consentPath, decision, web(cookie, "https://example.com"))).status).toBe(403);
  const approval = await post(consentPath, decision, web(cookie));
  expect(approval.status).toBe(303);
  const callback = new URL(approval.headers.get("Location")!);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe("test-state");

  const exchange = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: client.client_id,
    code: callback.searchParams.get("code")!,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: `${site}/mcp`,
  });
  const grant = await json(await post("/mcp/oauth/token", exchange));
  expect(grant.scope).toBe("read");
  const called = await json(await mcp("tools/call", grant.access_token, { name: tool }));
  expect(called.result.structuredContent).toHaveProperty("count");
  expect((await post("/mcp/oauth/token", exchange)).status).toBe(400);
  if (platform.api) expect((await request(counter, { headers: bearer(grant.access_token) })).status).toBe(401);
});
