import { expect, test } from "bun:test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const site = process.env.CONVEX_SITE_URL;
const cloud = process.env.CONVEX_URL;
if (!site || !cloud || new URL(site).hostname !== "127.0.0.1" || new URL(cloud).hostname !== "127.0.0.1") {
  throw new Error("Start an isolated local Convex deployment before running this test.");
}

function request(platform: "native" | "web", body: object, headers: Record<string, string> = {}) {
  return fetch(`${site}/api/auth/${platform}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Exact-Auth": "1", ...headers },
    body: JSON.stringify(body),
  });
}

function credentials() {
  return {
    username: `exact-${crypto.randomUUID().slice(0, 8)}`,
    password: `test-${crypto.randomUUID()}`,
  };
}

test("logout revokes an issued access token and its refresh token", async () => {
  const account = credentials();
  const response = await request("native", { operation: "password", create: true, ...account });
  expect(response.status).toBe(200);
  const signedIn = await response.json();
  expect(signedIn.viewer).toEqual({ name: account.username });
  const [accessToken, refreshToken] = signedIn.session.split("~");
  const client = new ConvexHttpClient(cloud, { auth: accessToken, logger: false });
  expect(await client.query(api.auth.viewer, {})).toEqual({ name: account.username });

  const logout = await request("native", { operation: "signOut" }, { "X-Exact-Session": signedIn.session });
  expect(logout.status).toBe(200);
  expect((await logout.json()).viewer).toBeNull();
  expect(await client.query(api.auth.viewer, {})).toBeNull();
  expect(await client.mutation(api.auth.refreshSession, { refreshToken })).toEqual({ kind: "noSession" });

  const invalid = await request("native", { operation: "password", ...account, create: false, password: "wrong password" });
  expect(invalid.status).toBe(401);
  expect(await invalid.json()).toEqual({ error: "INVALID_CREDENTIALS" });
  const login = await request("native", { operation: "password", create: false, ...account });
  expect(login.status).toBe(200);
  expect((await login.json()).viewer).toEqual({ name: account.username });
});

test("web cookies stay HttpOnly and cross-origin requests are rejected", async () => {
  const account = credentials();
  const signup = { operation: "password", create: true, ...account };
  expect((await request("web", signup, { Origin: "https://untrusted.example" })).status).toBe(403);
  expect((await request("native", signup, { Origin: site })).status).toBe(403);

  const result = await request("web", signup, { Origin: site });
  expect(result.status).toBe(200);
  const cookie = result.headers.get("Set-Cookie") ?? "";
  expect(cookie).toStartWith("__Host-exact-session=");
  expect(cookie).toContain("Path=/; Secure; HttpOnly; SameSite=Strict");
  expect(await result.json()).toEqual({ viewer: { name: account.username }, google: expect.any(Boolean) });
  const headers = { Origin: site, Cookie: cookie.split(";")[0] };
  const status = await request("web", { operation: "status" }, headers);
  expect((await status.json()).viewer).toEqual({ name: account.username });
  const logout = await request("web", { operation: "signOut" }, headers);
  expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
  expect((await (await request("web", { operation: "status" }, headers)).json()).viewer).toBeNull();
});

test("Google availability gates the server's OAuth start endpoint", async () => {
  const status = await request("native", { operation: "status" });
  expect(status.status).toBe(200);
  const { google } = await status.json();
  if (process.env.EXPECT_GOOGLE === "0" || process.env.EXPECT_GOOGLE === "1") {
    expect(google).toBe(process.env.EXPECT_GOOGLE === "1");
  }
  const start = await request("native", { operation: "googleStart", callbackState: crypto.randomUUID() });
  if (!google) {
    expect(start.status).toBe(404);
    expect(await start.json()).toEqual({ error: "GOOGLE_DISABLED" });
  } else {
    expect(start.status).toBe(200);
    const { redirect } = await start.json();
    const url = new URL(redirect);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${site}/oauth/google/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  }
});
