#!/usr/bin/env node
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
    return `Usage: ${name} list | call <operationId> [jsonArgs]\nSet DISPOSABL_API_ORIGIN and, for calls, DISPOSABL_API_KEY.`;
  }
  if (command === "--version" || command === "-v") return manifest.version;
  if (
    !(command === "list" && !id) &&
    !(command === "call" && id && !extra.length)
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

  const operation = operations.find((entry) => entry.operationId === id);
  if (!operation) throw new Error(`Unknown operation ${id}. Run ${name} list.`);
  const key = process.env.DISPOSABL_API_KEY;
  if (!key) throw new Error("Set DISPOSABL_API_KEY to call an operation.");
  const args = JSON.parse(rawArgs ?? "{}");
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
