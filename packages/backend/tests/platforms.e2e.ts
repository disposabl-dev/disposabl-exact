import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import config from "../../../disposabl.json";
import { api } from "../convex/_generated/api";
import { mcp as server } from "../convex/mcp";

const platforms: readonly string[] = config.platforms;
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
  expect(response.status).toBe(platforms.includes("api") ? 401 : 404);
  const missing = await mcp("tools/list");
  expect(missing.status).toBe(platforms.includes("mcp") ? 401 : 404);
  if (!platforms.includes("api") && !platforms.includes("mcp")) return;

  const cookie = await signIn();
  const issued = await form(
    "/api-keys",
    { name: "Local integration key" },
    cookie,
  );
  expect(issued.status).toBe(200);
  const key = (await issued.text()).match(/<code>([^<]+)<\/code>/)?.[1];
  if (!key) throw new Error("Expected an API key.");
  const headers = { Authorization: `Bearer ${key}` };
  if (platforms.includes("api")) {
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

  if (platforms.includes("mcp")) {
    const { tools } = await mcpResult(await mcp("tools/list", undefined, key));
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "counter_current",
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

  const credentials = await fetch(`${site}/api-keys`, {
    headers: { Cookie: cookie },
  });
  const grant = (await credentials.text()).match(
    /name="revoke" value="([^"]+)"/,
  )?.[1];
  if (!grant) throw new Error("Expected a revocable key.");
  expect((await form("/api-keys", { revoke: grant }, cookie)).status).toBe(303);
  if (platforms.includes("api"))
    expect((await fetch(endpoint, { headers })).status).toBe(401);
  if (platforms.includes("mcp"))
    expect((await mcp("tools/list", undefined, key)).status).toBe(401);
});

test.skipIf(!platforms.includes("mcp"))(
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
    if (platforms.includes("api")) {
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
