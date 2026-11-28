#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const name = Object.keys(manifest.bin)[0];

try {
  console.log(await run(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function run([command, id, rawArgs, ...extra]) {
  if (!command || command === "--help" || command === "-h") {
    return `Usage: ${name} list | call <operationId> [jsonArgs]\n       ${name} connections status | <github|convex> <status|connect|disconnect>\nSet DISPOSABL_API_ORIGIN and, for calls, DISPOSABL_API_KEY.`;
  }
  if (command === "--version" || command === "-v") return manifest.version;
  const connections = command === "connections";
  if (
    !(command === "list" && !id) &&
    !((command === "call" || connections) && id && !extra.length)
  ) {
    throw new Error(`Use ${name} --help for usage.`);
  }

  const origin = URL.parse(process.env.DISPOSABL_API_ORIGIN ?? "");
  if (
    !origin ||
    !["https:", "http:"].includes(origin.protocol) ||
    origin.href !== origin.origin + "/"
  ) {
    throw new Error("Set DISPOSABL_API_ORIGIN to the app's HTTP origin.");
  }
  const spec = await json(new URL("/openapi.json", origin));
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
    ["get", "post"]
      .filter((method) => methods[method])
      .map((method) => ({ ...methods[method], path, method })),
  );
  if (command === "list")
    return JSON.stringify(
      operations.map(({ operationId, description }) => ({
        operationId,
        description,
      })),
      null,
      2,
    );

  const operationId = connections ? connectionOperation(id, rawArgs) : id;
  const operation = operations.find((entry) => entry.operationId === operationId);
  if (!operation) throw new Error(`Unknown operation ${operationId}. Run ${name} list.`);
  const key = process.env.DISPOSABL_API_KEY;
  if (!key) throw new Error("Set DISPOSABL_API_KEY to call an operation.");
  const args = JSON.parse(connections ? "{}" : rawArgs ?? "{}");
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Operation arguments must be a JSON object.");
  }
  const url = new URL(operation.path, origin);
  if (
    url.origin !== origin.origin ||
    !url.pathname.startsWith("/api/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid operation path in OpenAPI.");
  }

  const headers = { Authorization: `Bearer ${key}` };
  if (operation.method === "post") {
    const result = await json(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (connections && rawArgs === "connect") await openConnectionLink(result?.url, id);
    return JSON.stringify(result, null, 2);
  }
  for (const [field, value] of Object.entries(args)) {
    const parameter = operation.parameters?.find(
      (parameter) => parameter.in === "query" && parameter.name === field,
    );
    if (!parameter) throw new Error(`Unknown query parameter ${field}.`);
    url.searchParams.set(
      field,
      parameter.content ? JSON.stringify(value) : String(value),
    );
  }
  return JSON.stringify(await json(url, { headers }), null, 2);
}

function connectionOperation(provider, action) {
  if (provider === "status" && !action) return "connections_internal_status";
  if (["github", "convex"].includes(provider) && ["status", "connect", "disconnect"].includes(action)) {
    return `connections_${provider}_internal_${action}`;
  }
  throw new Error(`Use ${name} connections status or ${name} connections <github|convex> <status|connect|disconnect>.`);
}

async function openConnectionLink(link, provider) {
  const url = typeof link === "string" ? URL.parse(link) : null;
  const origin = provider === "github" ? "https://github.com" : "https://dashboard.convex.dev";
  if (!url || url.origin !== origin || url.username || url.password) {
    throw new Error("The connection service returned an invalid authorization link.");
  }
  const [command, ...args] = process.platform === "darwin" ? ["open"] :
    process.platform === "win32" ? ["rundll32.exe", "url.dll,FileProtocolHandler"] : ["xdg-open"];
  await new Promise(resolve => {
    const browser = spawn(command, [...args, url.href], { detached: true, stdio: "ignore" });
    browser.once("error", resolve);
    browser.once("spawn", () => {
      browser.unref();
      resolve();
    });
  });
}

async function json(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null);
  throw new Error(
    `${url.pathname}: HTTP ${response.status}${body?.error ? ` (${body.error})` : ""}`,
  );
}
