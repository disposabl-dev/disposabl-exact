import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const app = realpathSync(resolve(import.meta.dir, "../apps/apps"));
const appCheckout = resolve(app, ".exact/checkout");
const cache = resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), ".cache"), "disposabl");
const cachedCheckout = resolve(cache, "exact");
const upstream = "https://github.com/expo/exact.git";
const isCheckout = (path) => path && [
  "scripts/app-cli.mjs",
  "scripts/filesystem.mjs",
  "packages/convex/package.json",
  "packages/store-update/package.json",
].every((file) => existsSync(resolve(path, file)));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.signal ?? result.status})`);
}

function checkout() {
  const override = process.env.EXACT || process.env.EXACT2;
  if (override) {
    const path = resolve(override);
    if (!isCheckout(path)) throw new Error(`Invalid Exact SDK at ${path}. Set EXACT to an expo/exact checkout.`);
    return path;
  }

  const executable = Bun.which("exact");
  const installed = executable && dirname(dirname(realpathSync(executable)));
  const existing = [appCheckout, installed, cachedCheckout].find(isCheckout);
  if (existing) return realpathSync(existing);

  mkdirSync(cache, { recursive: true });
  const staging = mkdtempSync(resolve(cache, "exact-"));
  try {
    const sdk = resolve(staging, "sdk");
    run("git", ["clone", "--depth=1", upstream, sdk], staging);
    if (!isCheckout(sdk)) throw new Error("The upstream checkout is missing the Exact app SDK.");
    try {
      renameSync(sdk, cachedCheckout);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code) || !isCheckout(cachedCheckout)) throw error;
    }
    return cachedCheckout;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function main(args) {
  const sdk = checkout();
  const { installLock, installedModules, withInstallLock } = await import(resolve(sdk, "scripts/filesystem.mjs"));
  const { linkCheckout } = await import(resolve(sdk, "scripts/paths.mjs"));
  const { installedFileDependencies } = await import(resolve(sdk, "scripts/file-dependencies.mjs"));

  installedModules(resolve(sdk, "node_modules"), installLock(realpathSync(sdk)));
  withInstallLock(installLock(app), () => {
    linkCheckout(app, undefined, sdk);
    run(process.execPath, ["install", "--frozen-lockfile"], app);
  });
  installedFileDependencies(app);

  if (args[0] === "bootstrap") return;
  if (args[0] === "run" && args[1] === "android") {
    const flags = args.slice(2);
    args = ["android", ...(flags.includes("--run") ? flags : ["--run", ...flags])];
  }

  const child = spawn(process.execPath, ["exact.mjs", ...args], {
    cwd: app,
    env: { ...process.env, EXACT: sdk },
    stdio: "inherit",
  });
  const forward = (signal) => child.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const status = await new Promise((done, fail) => {
    child.once("error", fail);
    child.once("exit", (code, signal) => done(code ?? (signal === "SIGINT" ? 130 : 143)));
  });
  process.exitCode = status;
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`exact: ${error.message}`);
  process.exitCode = 1;
}
