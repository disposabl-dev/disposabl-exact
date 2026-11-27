import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

const require = createRequire(import.meta.url);
const cliManifest = require.resolve("@disposabl/cli/package.json");
const cli = join(dirname(cliManifest), require(cliManifest).bin.disposabl);
const defaultOrigin = "https://www.disposabl.dev";
const web = JSON.stringify(["web"]);

export const git = (directory, ...args) =>
  execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();

export const readJson = async path => JSON.parse(await readFile(path, "utf8"));
export async function writeJson(path, value) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function runCli(directory, origin, args, interactive = false) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: directory,
      env: { ...process.env, DISPOSABL_API_ORIGIN: origin },
      stdio: interactive ? "inherit" : ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error('Disposabl setup failed at "' + args.slice(0, 2).join(" ") + '".'));
    });
  });
  return interactive ? undefined : JSON.parse(output);
}

async function updateEnv(directory, relativePath, variables, remove = []) {
  git(directory, "check-ignore", relativePath);
  const path = join(directory, relativePath);
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const keys = new Set([...Object.keys(variables), ...remove]);
  const retained = existing.split("\n").filter(line =>
    !keys.has(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line)?.[1]));
  const updated = Object.entries(variables).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  const temporary = join(git(directory, "rev-parse", "--absolute-git-dir"), `disposabl-env-${randomUUID()}`);
  try {
    await writeFile(temporary, [...retained, ...updated].join("\n").trimStart() + "\n", {
      flag: "wx", mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function githubRepository(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-z0-9-]+\/[a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url);
  return match?.[1].toLowerCase();
}

async function configureExact(directory, scratch) {
  const repository = git(scratch, "config", "--get", "remote.origin.url");
  const expected = githubRepository(repository);
  if (!expected) throw new Error("Disposabl did not configure a GitHub repository.");
  const remotes = git(directory, "remote").split("\n");
  if (remotes.includes("origin")) {
    const current = git(directory, "config", "--get", "remote.origin.url");
    if (githubRepository(current) !== expected) {
      throw new Error("The existing origin belongs to a different repository.");
    }
  } else {
    git(directory, "remote", "add", "origin", repository);
  }

  const env = parseEnv(await readFile(join(scratch, "packages/backend/.env.local"), "utf8"));
  const { CONVEX_DEPLOY_KEY, CONVEX_URL, CONVEX_SITE_URL } = env;
  if (!CONVEX_DEPLOY_KEY || !CONVEX_URL || !CONVEX_SITE_URL) {
    throw new Error("Disposabl did not write the Convex development configuration.");
  }
  await updateEnv(directory, "packages/backend/.env.local", {
    CONVEX_DEPLOY_KEY,
    CONVEX_URL,
    CONVEX_SITE_URL,
  }, ["CONVEX_DEPLOYMENT"]);
  await updateEnv(directory, "apps/apps/.env.local", {
    CONVEX_ORIGIN: CONVEX_URL.replace(/^https:/, "wss:"),
    CONVEX_SITE_ORIGIN: CONVEX_SITE_URL,
  });
}

export async function setup(directory, name, config) {
  const origin = process.env.DISPOSABL_API_ORIGIN || defaultOrigin;
  if (config.appId && config.serviceOrigin !== origin) {
    throw new Error("Set DISPOSABL_API_ORIGIN to the original Disposabl API origin before resuming.");
  }

  const features = JSON.stringify(config.features.filter(feature => feature !== "payments"));
  const run = (args, interactive) => runCli(directory, origin, args, interactive);
  if (!(await run(["login", "status"])).currentUser) {
    await run(["login"], true);
    if (!(await run(["login", "status"])).currentUser) throw new Error("Disposabl login did not complete.");
  }
  if (!(await run(["connections", "status", "--features", features, "--wait", "--setup-origin"])).ready) {
    throw new Error("Connect GitHub and Convex to continue setup.");
  }

  if (!config.appId) {
    const app = await run(["apps", "create", "--name", name, "--platforms", web, "--features", features]);
    if (typeof app.appId !== "string" || !app.appId) throw new Error("Disposabl did not return an app ID.");
    config.appId = app.appId;
    config.serviceOrigin = origin;
    await writeJson(join(directory, "disposabl.json"), config);
  }

  // The published CLI configures the legacy layout. Keep that layout and its
  // development credentials in a private, disposable Git checkout.
  const scratch = await mkdtemp(join(tmpdir(), "disposabl-web-setup-"));
  try {
    await mkdir(join(scratch, "apps/web"), { recursive: true });
    await mkdir(join(scratch, "packages/backend"), { recursive: true });
    await writeFile(join(scratch, ".gitignore"), "*.local\n");
    await writeJson(join(scratch, "disposabl.json"), {
      appId: config.appId, platforms: ["web"], features: JSON.parse(features),
    });
    git(scratch, "init", "--quiet", "--initial-branch=main");
    const result = await run([
      "previews", "token", "create", "--appId", config.appId, "--reference", "main",
      "--platforms", web, "--features", features, "--configure", scratch,
    ]);
    if (!result.configured) throw new Error("Disposabl did not configure the development deployment.");
    await configureExact(directory, scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
