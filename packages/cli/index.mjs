#!/usr/bin/env node
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const name = Object.keys(manifest.bin)[0];
const [command, operationId, rawArgs, ...extra] = process.argv.slice(2);

try {
  if (!command || command === "--help" || command === "-h") {
    console.log(
      `Usage: ${name} list | call <operationId> [jsonArgs]\nSet DISPOSABL_API_ORIGIN and, for calls, DISPOSABL_API_KEY.`,
    );
  } else if (command === "--version" || command === "-v") {
    console.log(manifest.version);
  } else {
    if (
      !(command === "list" && !operationId) &&
      !(command === "call" && operationId && !extra.length)
    ) {
      throw new Error(`Use ${name} --help for usage.`);
    }
    const origin = new URL(process.env.DISPOSABL_API_ORIGIN ?? "");
    if (
      !["https:", "http:"].includes(origin.protocol) ||
      origin.href !== origin.origin + "/"
    ) {
      throw new Error("Set DISPOSABL_API_ORIGIN to the app's HTTP origin.");
    }
    const spec = await json(new URL("/openapi.json", origin));
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      ["get", "post"]
        .filter((method) => methods[method])
        .map((method) => ({
          ...methods[method],
          path,
          method,
        })),
    );
    if (command === "list") {
      console.log(
        JSON.stringify(
          operations.map(({ operationId, description }) => ({
            operationId,
            description,
          })),
          null,
          2,
        ),
      );
    } else {
      const operation = operations.find(
        (entry) => entry.operationId === operationId,
      );
      if (!operation)
        throw new Error(`Unknown operation ${operationId}. Run ${name} list.`);
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
      const options = { method: operation.method.toUpperCase(), headers };
      if (operation.method === "get") {
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
      } else {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(args);
      }
      console.log(JSON.stringify(await json(url, options), null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function json(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `${url.pathname}: HTTP ${response.status}${body?.error ? ` (${body.error})` : ""}`,
    );
  return body;
}
