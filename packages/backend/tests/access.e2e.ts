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
const credentials = "/api/dashboard/api-keys";

function post(path: string, body: object, headers: Record<string, string> = {}) {
  return fetch(new URL(path, site), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("the deployed configuration controls feature flags and route access", async () => {
  const { authentication, payments, consent } = platform;
  expect(await client.query(api.app.features, {})).toEqual({ authentication, payments, consent, credentials: platform.credentials });

  const headers = { Origin: site, "X-Exact-Auth": "1" };
  const keys = await fetch(new URL(credentials, site), { headers });
  expect(keys.status).toBe(platform.credentials ? 401 : 404);
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
    const listed = await fetch(new URL(credentials, site), { headers: session });
    expect(listed.status).toBe(200);
    const { connections } = await listed.json();
    const revoked = await post(credentials, { operation: "revoke", id: connections[0].id }, session);
    expect(revoked.status).toBe(200);
  }

  expect((await post(auth, { operation: "signOut" }, session)).status).toBe(200);
  const status = await post(auth, { operation: "status" }, session);
  expect(await status.json()).toMatchObject({ viewer: null });
});
