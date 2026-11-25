import { expect, test } from "bun:test";
import { ConvexHttpClient } from "convex/browser";
import { platform } from "@disposabl-kit/server/platforms.ts";
import { api } from "../convex/_generated/api";

const site = process.env.CONVEX_SITE_URL;
const cloud = process.env.CONVEX_URL;
if (!site || !cloud || [site, cloud].some(url => new URL(url).hostname !== "127.0.0.1")) {
  throw new Error("Run the access tests against an isolated local Convex deployment.");
}

const client = new ConvexHttpClient(cloud, { logger: false });
const auth = "/api/auth/web";
const credentials = "/api/platform/credentials";
const counter = "/api/counter/current";
const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

function post(path: string, body: object, headers: Record<string, string> = {}) {
  return fetch(new URL(path, site), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mcp(key?: string) {
  return post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "counter_current" } }, {
    Accept: "application/json, text/event-stream",
    ...(key ? bearer(key) : {}),
  });
}

test("the deployed configuration controls feature flags and route access", async () => {
  const { authentication, payments, consent, credentials } = platform;
  expect(await client.query(api.app.features, {})).toEqual({ authentication, payments, consent, credentials });
  expect((await fetch(new URL(counter, site))).status).toBe(platform.api ? 401 : 404);
  expect((await mcp()).status).toBe(platform.mcp ? 401 : 404);

  const headers = { Origin: site, "X-Exact-Auth": "1" };
  const session = await post(auth, { operation: "status" }, headers);
  expect(session.status).toBe(platform.web && authentication ? 200 : 404);
  const billing = await post("/api/billing/web", { operation: "status" }, headers);
  expect(billing.status).toBe(platform.web && payments ? 200 : 404);
});

test.skipIf(!platform.web || !platform.authentication)("web sessions and issued keys can be revoked", async () => {
  const username = `app-${crypto.randomUUID().slice(0, 8)}`;
  const headers = { Origin: site, "X-Exact-Auth": "1" };
  const signup = { operation: "password", create: true, username, password: crypto.randomUUID() };
  expect((await post(auth, signup, { ...headers, Origin: "https://untrusted.example" })).status).toBe(403);
  const signedIn = await post(auth, signup, headers);
  expect(signedIn.status).toBe(200);
  expect(await signedIn.json()).toMatchObject({ viewer: { name: username } });
  const cookie = signedIn.headers.get("Set-Cookie");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  const session = { ...headers, Cookie: cookie!.split(";")[0] };

  if (platform.credentials) {
    const issued = await post(credentials, { operation: "create", name: "Access test", write: false }, session);
    expect(issued.status).toBe(200);
    const { key } = await issued.json();
    const expected = await client.query(api.counter.get, {});
    const callRest = () => fetch(new URL(counter, site), { headers: bearer(key) });

    if (platform.api) {
      const response = await callRest();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
    }
    if (platform.mcp) {
      const response = await mcp(key);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: { structuredContent: expected } });
    }

    const listed = await fetch(new URL(credentials, site), { headers: session });
    expect(listed.status).toBe(200);
    const { connections } = await listed.json();
    const revoked = await post(credentials, { operation: "revoke", id: connections[0].id }, session);
    expect(revoked.status).toBe(200);
    if (platform.api) expect((await callRest()).status).toBe(401);
    if (platform.mcp) expect((await mcp(key)).status).toBe(401);
  }

  expect((await post(auth, { operation: "signOut" }, session)).status).toBe(200);
  const status = await post(auth, { operation: "status" }, session);
  expect(await status.json()).toMatchObject({ viewer: null });
});
