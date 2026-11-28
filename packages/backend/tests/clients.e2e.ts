import { expect, test } from "bun:test";
import { $ } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { platform } from "@disposabl-kit/server/platforms.ts";

const site = process.env.CONVEX_SITE_URL;
const cloud = process.env.CONVEX_URL;
const output = process.env.CLIENT_TEST_OUTPUT;
if (
  !output ||
  !site ||
  !cloud ||
  [site, cloud].some((value) => new URL(value).hostname !== "127.0.0.1")
) {
  throw new Error(
    "Use clients-ci.ts to run package tests with an isolated local Convex deployment.",
  );
}
const origin = site;
const root = resolve(import.meta.dir, "../../..");
const checkout = (pkg: string) => resolve(root, "packages", pkg);
const withKey = (key: string) => ({ Authorization: `Bearer ${key}` });
const authHeaders = {
  "Content-Type": "application/json",
  "X-Exact-Auth": "1",
  Origin: origin,
};
const operation = (path: string, options?: RequestInit) =>
  fetch(new URL(path, origin), options);
const paymentId = "billing_index_status";
const paymentPath = "/api/billing/index/status";
const fixture = process.env.CLIENT_TEST_FIXTURE === "1";

async function convex(name: string, args: object) {
  const { stdout } = await $`bun run convex run ${name} ${JSON.stringify(args)}`
    .cwd(resolve(root, "packages/backend"))
    .quiet();
  return stdout.length ? JSON.parse(stdout.toString()) : null;
}

async function readKey() {
  if (!(platform.web && platform.authentication)) {
    const userId = await convex("mcp:createServiceUser", {
      name: "Client tests",
    });
    const { apiKey } = await convex("mcp:createApiKeyForUser", {
      userId,
      scopes: ["read"],
    });
    return { userId, key: apiKey };
  }

  const signup = await operation("/api/auth/web", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      operation: "password",
      create: true,
      username: `client-${crypto.randomUUID().slice(0, 16)}`,
      password: crypto.randomUUID(),
    }),
  });
  expect(signup.status).toBe(200);
  const headers = {
    ...authHeaders,
    Cookie: signup.headers.getSetCookie()[0].split(";")[0],
  };
  const response = await operation("/api/dashboard/api-keys", {
    method: "POST",
    headers,
    body: JSON.stringify({
      operation: "create",
      name: "Client tests",
      write: false,
    }),
  });
  expect(response.status).toBe(200);
  const grant = await response.json();
  const whoami = await operation(
    "/api/clientTest/lookup?name=test&filter=%7B%22tags%22%3A%5B%5D%7D",
    {
      headers: withKey(grant.key),
    },
  );
  expect(whoami.status).toBe(200);
  return { userId: (await whoami.json()).userId, key: grant.key };
}

test("installed packages follow the deployed API and feature settings", async () => {
  const install = await mkdtemp(join(tmpdir(), "exact-clients-"));
  await mkdir(output, { recursive: true });
  try {
    if (platform.packages.includes("sdk")) {
      await $`bun run build`
        .cwd(checkout("sdk"))
        .env({ ...process.env, DISPOSABL_API_ORIGIN: origin });
    }
    const archives = [];
    for (const pkg of platform.packages) {
      const [pack] = await $`npm pack --pack-destination ${output} --json`
        .cwd(checkout(pkg))
        .json();
      archives.push(join(output, pack.filename));
    }
    await $`npm install --ignore-scripts --no-audit --no-fund ${archives}`
      .cwd(install)
      .quiet();

    const cliManifest = await Bun.file(
      join(checkout("cli"), "package.json"),
    ).json();
    const cli = async (key: string, ...args: string[]) => {
      const bin = join(
        install,
        "node_modules",
        ".bin",
        Object.keys(cliManifest.bin)[0],
      );
      return await $`node ${bin} ${args}`
        .env({
          ...process.env,
          DISPOSABL_API_ORIGIN: origin,
          DISPOSABL_API_KEY: key,
        })
        .nothrow()
        .quiet();
    };
    const cliCalls = platform.packages.includes("cli");
    const sdkManifest = await Bun.file(
      join(checkout("sdk"), "package.json"),
    ).json();
    const sdk = platform.packages.includes("sdk")
      ? await import(
          join(
            install,
            "node_modules",
            sdkManifest.name,
            sdkManifest.exports["."].import,
          )
        )
      : undefined;
    if (sdk) expect(typeof sdk.createClient).toBe("function");
    const spec = await (await operation("/openapi.json")).json();
    const billingAvailable = spec["x-disposabl"].payments;
    if (fixture) expect(billingAvailable).toBe(false);
    if (cliCalls) {
      const listed = await cli("", "list");
      expect(listed.exitCode).toBe(0);
      expect(
        listed
          .json()
          .some(
            ({ operationId }: { operationId: string }) =>
              operationId === paymentId,
          ),
      ).toBe(billingAvailable);
    }
    if (sdk)
      expect(typeof sdk.billingIndexStatus === "function").toBe(
        billingAvailable,
      );
    if (!fixture) return;

    expect(
      (
        await operation("/api/auth/web", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ operation: "status" }),
        })
      ).status,
    ).toBe(platform.authentication && platform.web ? 200 : 404);
    expect((await operation(paymentPath)).status).toBe(404);
    if (cliCalls) {
      const billing = await cli("", "billing", "status");
      expect(billing.exitCode).not.toBe(0);
      expect(billing.stderr.toString()).toContain("unknown command 'billing'");
    }

    const { userId, key } = await readKey();
    if (platform.mcp) {
      const response = await operation("/mcp", {
        method: "POST",
        headers: {
          ...withKey(key),
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const { result } = await response.json();
      expect(result.tools.some(({ name }: { name: string }) => name === paymentId)).toBe(false);
    }
    const writable = await convex("mcp:createApiKeyForUser", {
      userId,
      scopes: ["read", "write"],
    });
    const filter = { tags: ["a b", "+"] };
    const query = { name: "hello + world", filter };
    const expected = { ...query, userId };
    const sdkClient = (key?: string) =>
      sdk.createClient({ baseUrl: origin, auth: key });
    if (cliCalls) {
      expect(
        (
          await cli(key, "call", "clientTest_lookup", JSON.stringify(query))
        ).json(),
      ).toEqual(expected);
      expect(
        (
          await cli(key, "call", "clientTest_echo", JSON.stringify({ filter }))
        ).stderr.toString(),
      ).toContain("insufficient_scope");
      expect(
        (
          await cli(
            writable.apiKey,
            "call",
            "clientTest_echo",
            JSON.stringify({ filter }),
          )
        ).json(),
      ).toEqual(filter);
      expect(
        (
          await cli(
            "invalid",
            "call",
            "clientTest_lookup",
            JSON.stringify(query),
          )
        ).stderr.toString(),
      ).toContain("unauthorized");
    }
    if (sdk) {
      expect(
        (await sdk.clientTestLookup({ client: sdkClient(key), query })).data,
      ).toEqual(expected);
      expect(
        (await sdk.clientTestEcho({ client: sdkClient(key), body: { filter } }))
          .response.status,
      ).toBe(403);
      expect(
        (
          await sdk.clientTestEcho({
            client: sdkClient(writable.apiKey),
            body: { filter },
          })
        ).data,
      ).toEqual(filter);
      expect(
        (await sdk.clientTestLookup({ client: sdkClient(), query })).response
          .status,
      ).toBe(401);
    }

    const connections = await convex("mcp:createApiKeyForUser", {
      userId,
      scopes: ["read"],
    });
    await convex("mcp:revokeServiceKey", { userId, id: connections.id });
    if (cliCalls)
      expect(
        (
          await cli(
            connections.apiKey,
            "call",
            "clientTest_lookup",
            JSON.stringify(query),
          )
        ).stderr.toString(),
      ).toContain("unauthorized");
    if (sdk)
      expect(
        (
          await sdk.clientTestLookup({
            client: sdkClient(connections.apiKey),
            query,
          })
        ).response.status,
      ).toBe(401);
  } finally {
    await rm(install, { recursive: true, force: true });
  }
}, 120_000);
