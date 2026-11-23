import { describe, expect, test } from "bun:test";

const site = process.env.CONVEX_SITE_URL;
if (!site || new URL(site).hostname !== "127.0.0.1") {
  throw new Error("Run this suite against an isolated local Convex deployment.");
}

function post(path: string, body: object, session?: string, origin?: string) {
  return fetch(new URL(path, site), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Exact-Auth": "1",
      ...(session ? { "X-Exact-Session": session } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function createSession() {
  const response = await post("/api/auth/native", {
    operation: "password", create: true,
    username: `billing-${crypto.randomUUID().slice(0, 8)}`,
    password: "a long battery of correct horses",
  });
  expect(response.ok).toBe(true);
  return (await response.json()).session as string;
}

const platform = "google-play";
const native = "/api/billing/native";
const web = "/api/billing/web";

describe("billing boundary", () => {
  test("checkout and simulated grants require their own authenticated platform route", async () => {
    expect((await post(web, { operation: "status" }, undefined, "https://other.invalid")).status).toBe(403);
    expect((await post(native, { operation: "previewPurchase", platform, offer: "topup" })).status).toBe(401);
    expect((await post(web, { operation: "checkout", offer: "monthly" }, undefined, site)).status).toBe(401);
  });

  test("preview grants monthly credits and a repeatable top-up once per request", async () => {
    const session = await createSession();
    const status = async () => (await post(native, { operation: "status", platform }, session)).json();
    const first = await status();
    expect(first.mode).toBe("preview");
    expect(first.storeEnabled).toBe(false);
    expect(first.monthlyActive).toBe(false);
    const purchase = (offer: string, requestId: string) =>
      post(native, { operation: "previewPurchase", platform, offer, requestId }, session);
    expect((await purchase("monthly", crypto.randomUUID())).ok).toBe(true);
    const requestId = crypto.randomUUID();
    expect((await purchase("topup", requestId)).ok).toBe(true);
    expect((await purchase("topup", requestId)).ok).toBe(true);
    const after = await status();
    expect(after.monthlyActive).toBe(true);
    expect(after.credits).toBe(first.credits + first.monthlyCredits + first.topupCredits);
    expect((await purchase("topup", crypto.randomUUID())).ok).toBe(true);
    expect((await status()).credits).toBe(after.credits + first.topupCredits);
    const other = await createSession();
    const otherStatus = await (await post(native, { operation: "status", platform }, other)).json();
    expect(otherStatus.monthlyActive).toBe(false);
    expect(otherStatus.credits).toBe(first.credits);
    expect((await post(native, { operation: "storePurchase", platform, offer: "monthly", proof: "agent-fake" }, session)).status).toBe(503);
  });
});
