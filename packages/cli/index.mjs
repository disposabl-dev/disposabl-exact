#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { Command } from "commander";
import { accessToken, hasCredentials, login, logout, NotAuthenticated, openUrl } from "./auth.mjs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const program = new Command().name("disposabl").version(version)
  .description("Control a Disposabl app from the command line")
  .option("--origin <url>", "App API origin");

function readOptional(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function targetOrigin() {
  const explicit = program.opts().origin ?? process.env.DISPOSABL_API_ORIGIN;
  if (explicit) return apiOrigin(explicit);
  for (let directory = process.cwd(); ; directory = dirname(directory)) {
    const config = readOptional(join(directory, "disposabl.json"));
    if (config) {
      const local = readOptional(join(directory, "packages/backend/.env.local"));
      const origin = (local && parseEnv(local).CONVEX_SITE_URL) || JSON.parse(config).apiOrigin;
      if (origin) return apiOrigin(origin);
      throw new Error("Start this app with bun run dev or set DISPOSABL_API_ORIGIN.");
    }
    if (directory === dirname(directory)) return "https://www.disposabl.dev";
  }
}

function apiOrigin(value) {
  const url = URL.parse(value);
  const localhost = url?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!url || (url.protocol !== "https:" && !localhost) || url.href !== url.origin + "/") {
    throw new Error("Use an HTTPS API origin, or an HTTP loopback origin for local development.");
  }
  return url.origin;
}

function request(url, options = {}) {
  return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(options.timeout ?? 30_000) });
}

async function result(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? ("HTTP " + response.status));
  return body;
}

let contractPromise;
function contract(timeout) {
  return contractPromise ??= (async () => {
    const origin = targetOrigin();
    const spec = await result(await request(origin + "/openapi.json", { timeout }));
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      ["get", "post"].filter(method => methods[method]).map(method => ({ path, method, ...methods[method] })),
    );
    return { origin, authentication: spec["x-disposabl"]?.authentication ?? true, operations };
  })();
}

async function authenticatedRequest(url, options, origin) {
  const send = async (refresh = false) => {
    const token = await accessToken(origin, refresh);
    return request(url, { ...options, headers: { ...options.headers, Authorization: "Bearer " + token } });
  };
  const response = await send();
  return response.status === 401 && !process.env.DISPOSABL_API_KEY ? send(true) : response;
}

async function loginStatus() {
  const { origin, authentication } = await contract();
  let currentUser = null;
  if (authentication && await hasCredentials(origin)) {
    try {
      const response = await authenticatedRequest(origin + "/api/users/current", {}, origin);
      if (response.status !== 401) currentUser = await result(response);
    } catch (error) {
      if (!(error instanceof NotAuthenticated)) throw error;
    }
  }
  return { authentication, currentUser };
}

const output = value => console.log(JSON.stringify(value, null, 2));
const loginCommand = program.command("login").description("Sign in to the target app")
  .option("--no-browser", "Print the sign-in link")
  .action(async ({ browser }) => {
    const { origin, authentication } = await contract();
    if (!authentication) return output({ authentication });
    await login(origin, browser);
    console.error("Signed in.");
  });
loginCommand.command("status").description("Check the current session")
  .action(async () => output(await loginStatus()));
program.command("status").description("Check whether the app requires login and report the current user")
  .action(async () => output(await loginStatus()));
program.command("logout").description("Sign out of the target app").action(async () => {
  const { origin, authentication } = await contract();
  if (authentication) await logout(origin);
  output({ authentication, currentUser: null });
});

function commandParts(path) {
  if (!/^\/api\/[a-zA-Z0-9_/-]+$/.test(path)) throw new Error("Invalid operation path in OpenAPI.");
  const parts = path.slice(5).split("/");
  if (parts.at(-2) === "index" || parts.at(-2) === "internal") parts.splice(-2, 1);
  return parts;
}

function fields(operation) {
  if (operation.method === "get") {
    return (operation.parameters ?? []).filter(field => field.in === "query").map(field => ({
      name: field.name, required: field.required, jsonEncoded: Boolean(field.content),
      schema: field.schema ?? field.content?.["application/json"]?.schema,
    }));
  }
  const schema = operation.requestBody?.content?.["application/json"]?.schema;
  return Object.entries(schema?.properties ?? {}).map(([name, field]) => ({
    name, schema: field, required: schema.required?.includes(name),
  }));
}

async function call(operation, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Operation arguments must be a JSON object.");
  }
  const { origin, authentication } = await contract();
  const url = new URL(operation.path, origin);
  commandParts(operation.path);
  const parameters = fields(operation);
  for (const name of Object.keys(args)) {
    if (!parameters.some(field => field.name === name)) throw new Error("Unknown argument " + name + ".");
  }
  const options = { method: operation.method.toUpperCase() };
  if (operation.method === "get") {
    for (const field of parameters) {
      if (!(field.name in args)) continue;
      const value = args[field.name];
      url.searchParams.set(field.name, field.jsonEncoded ? JSON.stringify(value) : String(value));
    }
  } else {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(args);
    if (operation.path === "/api/apps/create") options.timeout = 120_000;
  }

  if (operation.security?.length === 0) return result(await request(url, options));
  if (!authentication && !process.env.DISPOSABL_API_KEY) {
    throw new Error("Set DISPOSABL_API_KEY for this user-scoped operation.");
  }
  return result(await authenticatedRequest(url, options, origin));
}

program.command("list").description("List the operations enabled for this app").action(async () => {
  const { operations } = await contract();
  output(operations.map(({ operationId, path, description }) =>
    ({ operationId, command: "disposabl " + commandParts(path).join(" "), description })));
});
program.command("call <operationId> [jsonArgs]").description("Call an operation with a JSON object")
  .action(async (id, jsonArgs = "{}") => {
    const operation = (await contract()).operations.find(entry => entry.operationId === id);
    if (!operation) throw new Error("Unknown operation " + id + ". Run disposabl list.");
    output(await call(operation, JSON.parse(jsonArgs)));
  });

function addOperation(operation) {
  const parts = commandParts(operation.path);
  const [first] = parts;
  if (["login", "status", "logout", "list", "call", "help"].includes(first)) return;
  let parent = program;
  for (const part of parts.slice(0, -1)) {
    parent = parent.commands.find(command => command.name() === part) ?? parent.command(part);
  }
  const command = parent.command(parts.at(-1)).description(operation.description ?? "");
  const parameters = fields(operation);
  for (const field of parameters) {
    const flag = "--" + field.name + " <value>";
    const description = field.schema?.type === "string" ? field.name : field.name + " as JSON";
    if (field.required) command.requiredOption(flag, description);
    else command.option(flag, description);
  }
  const provider = parts[0] === "connections" && parts[2] === "connect" ? parts[1] : null;
  if (provider) command.option("--no-browser", "Print the provider link");
  command.action(async options => {
    const args = Object.fromEntries(parameters.filter(field => options[field.name] !== undefined)
      .map(field => [field.name, field.schema?.type === "string" ? options[field.name] : JSON.parse(options[field.name])]));
    const response = await call(operation, args);
    if (provider && options.browser) {
      const url = URL.parse(response?.url);
      const expected = provider === "github" ? "https://github.com" : "https://dashboard.convex.dev";
      if (!url || url.origin !== expected || url.username || url.password) throw new Error("Invalid provider authorization link.");
      openUrl(url.href);
    }
    output(response);
  });
}

try {
  program.exitOverride();
  const args = process.argv.slice(2);
  const operands = program.parseOptions(args).operands;
  const first = operands[0];
  const help = args.includes("--help") || args.includes("-h") || first === "help";
  const dynamic = first && !["login", "status", "logout", "list", "call", "help"].includes(first);
  if (dynamic || (help && first !== "login") || !args.length) {
    try {
      for (const operation of (await contract(dynamic ? undefined : 2_000)).operations) addOperation(operation);
    } catch (error) {
      if (dynamic) throw error;
    }
  }
  if (!args.length) program.outputHelp();
  else await program.parseAsync(args, { from: "user" });
} catch (error) {
  if (error.code !== "commander.helpDisplayed" && error.code !== "commander.version") {
    if (!error.code?.startsWith("commander.")) console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
