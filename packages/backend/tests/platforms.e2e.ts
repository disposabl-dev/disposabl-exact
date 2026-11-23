import { expect, test } from "bun:test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "../convex/_generated/api";

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

function mcp(method: string, params?: object, origin?: string) {
  return fetch(`${site}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function mcpResult(response: Response) {
  expect(response.status).toBe(200);
  const data = (await response.text())
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (!data) throw new Error("Expected an MCP response event.");
  return JSON.parse(data.slice("data: ".length)).result;
}

test("REST and the read-only MCP tool expose the existing public counter", async () => {
  const client = new ConvexHttpClient(cloud);
  const expected = await client.query(api.counter.get, {});
  await expect(
    client.query(makeFunctionReference<"query">("counter:current"), {}),
  ).rejects.toThrow("Could not find public function");
  const response = await fetch(`${site}/api/counter/current`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected);

  const { tools } = await mcpResult(await mcp("tools/list"));
  expect(tools).toHaveLength(1);
  expect(tools[0]).toMatchObject({
    name: "counter_current",
    annotations: { readOnlyHint: true },
  });
  const result = await mcpResult(
    await mcp("tools/call", { name: "counter_current" }),
  );
  expect(result.structuredContent).toEqual(expected);
  expect(
    (await mcp("tools/list", undefined, "https://example.com")).status,
  ).toBe(403);
});
