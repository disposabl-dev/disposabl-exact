import { expect, test } from "bun:test";
import { platform } from "@disposabl-kit/server/platforms.ts";

const site = process.env.CONVEX_SITE_URL;
if (!site || new URL(site).hostname !== "127.0.0.1") {
  throw new Error("Run this suite against an isolated local Convex deployment.");
}

function post(path: string, body: object, origin?: string, session?: string) {
  return fetch(new URL(path, site), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Exact-Auth": "1",
      ...(origin ? { Origin: origin } : {}),
      ...(session ? { "X-Exact-Session": session } : {}),
    },
    body: JSON.stringify(body),
  });
}

const native = "/api/billing/native";
const web = "/api/billing/web";
const status = { operation: "status" };
const checkout = { operation: "checkout", offer: "topup", requestId: crypto.randomUUID() };

test("billing endpoints follow enabled features and platforms", async () => {
  expect((await post(web, status, site)).status).toBe(platform.payments && platform.web ? 200 : 404);
  expect((await post(native, status)).status).toBe(platform.payments && platform.native ? 200 : 404);
});

test.skipIf(!platform.payments || !platform.web || !platform.native)("billing authorizes web checkout and exposes read-only status to native apps", async () => {
  expect((await post(web, status, "https://other.invalid")).status).toBe(403);
  expect((await post(web, checkout, site)).status).toBe(401);
  expect((await post(native, checkout)).status).toBe(400);

  const response = await post(native, status);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ credits: null, planId: null, managedOnWeb: false, monthlyActive: false, topupCredits: 500 });
});

test.skipIf(!platform.payments || !platform.native)("billing stops exposing customer balances after sign out", async () => {
  const response = await post("/api/auth/native", {
    operation: "password", create: true,
    username: `billing-${crypto.randomUUID().slice(0, 8)}`,
    password: "a long battery of correct horses",
  });
  expect(response.ok).toBe(true);
  const { session } = await response.json();
  const before = await (await post(native, status, undefined, session)).json();
  expect(before.credits).toBe(before.mode === "off" ? null : 0);
  expect((await post("/api/auth/native", { operation: "signOut" }, undefined, session)).ok).toBe(true);
  expect(await (await post(native, status, undefined, session)).json()).toMatchObject({ credits: null, planId: null, managedOnWeb: false });
});
