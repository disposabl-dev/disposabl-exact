#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, resolve } from "node:path";

const cache = resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), ".cache"), "disposabl");
const cachedCheckout = resolve(cache, "exact");
const upstream = "https://github.com/expo/exact.git";
const isCheckout = (path) => path && [
  "scripts/app-cli.mjs",
  "scripts/filesystem.mjs",
  "packages/convex/package.json",
  "packages/store-update/package.json",
].every((file) => existsSync(resolve(path, file)));

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.signal ?? result.status})`);
}

function checkout(app) {
  const override = process.env.EXACT || process.env.EXACT2;
  if (override) {
    const path = resolve(override);
    if (!isCheckout(path)) throw new Error(`Invalid Exact SDK at ${path}. Set EXACT to an expo/exact checkout.`);
    return path;
  }

  const executable = Bun.which("exact");
  const installed = executable && dirname(dirname(realpathSync(executable)));
  const existing = [app && resolve(app, ".exact/checkout"), installed, cachedCheckout].find(isCheckout);
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

function projectWrapper() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const wrapper = resolve(dir, "scripts/exact.mjs");
    if (existsSync(wrapper) && existsSync(resolve(dir, "apps/apps/exact.mjs")) &&
        existsSync(resolve(dir, "disposabl.json"))) return wrapper;
    if (dir === dirname(dir)) return null;
  }
}

function installCli() {
  if (process.env.CI || Bun.which("exact")) return;
  const bin = resolve(process.env.BUN_INSTALL || resolve(homedir(), ".bun"), "bin");
  mkdirSync(bin, { recursive: true });
  const staging = mkdtempSync(resolve(bin, ".exact-"));
  try {
    const shim = resolve(staging, "exact");
    copyFileSync(import.meta.path, shim);
    chmodSync(shim, 0o755);
    try {
      linkSync(shim, resolve(bin, "exact"));
      if (!Bun.which("exact")) console.log(`Add ${bin} to PATH to use the exact command.`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function ensureRust() {
  if (Bun.which("rustup")) return;
  const staging = mkdtempSync(resolve(tmpdir(), "exact-rustup-"));
  try {
    const installer = resolve(staging, "rustup.sh");
    run("curl", ["--fail", "--silent", "--show-error", "--location", "https://sh.rustup.rs", "--output", installer], staging);
    run("sh", [installer, "-y", "--no-modify-path", "--default-toolchain", "none"], staging);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function prepareAndroid(sdk, app, args) {
  const { androidDevice, androidJavaEnv, androidJavaFix, androidToolchainEnv } =
    await import(resolve(sdk, "scripts/agent-android.mjs"));
  if (args.includes("--run")) process.env.ANDROID_SERIAL = androidDevice();
  const { androidAbis, ANDROID_ABIS, androidHermesDir } =
    await import(resolve(sdk, "scripts/android-abi.mjs"));
  const abiFlag = args.indexOf("--abis");
  const targets = androidAbis(abiFlag < 0 ? undefined : args[abiFlag + 1] ?? "").map((abi) => ANDROID_ABIS[abi]);
  if (!args.includes("--headless")) {
    if (!androidJavaEnv()) throw new Error(androidJavaFix());
    for (const target of targets) androidToolchainEnv(process.env, process.platform, undefined, target);
  }

  const { cargoEnvironment, hermesBundle } = await import(resolve(sdk, "scripts/app.mjs"));
  const cli = resolve(sdk, "scripts/exact.mjs");
  const check = spawnSync(process.execPath, [cli, "setup", "--check", "--platform", "android"], {
    cwd: sdk, env: { ...process.env, EXACT_APP_DIR: app },
  });
  const { channel, profile, components, targets: pinnedTargets } =
    Bun.TOML.parse(readFileSync(resolve(sdk, "rust-toolchain.toml"), "utf8")).toolchain;
  const installed = spawnSync("rustup", ["target", "list", "--installed", "--toolchain", channel], { encoding: "utf8" });
  if (check.status === 0 && hermesBundle().installed && targets.every((target) =>
    installed.stdout?.split("\n").includes(target) && androidHermesDir(process.env, undefined, target))) return;

  ensureRust();
  run("rustup", ["toolchain", "install", channel, "--profile", profile,
    ...components.flatMap((component) => ["--component", component]),
    ...[...new Set([...pinnedTargets, ...targets])].flatMap((target) => ["--target", target])], sdk);
  const env = cargoEnvironment();
  run("cargo", [`+${channel}`, "fetch", "--locked"], sdk, env);
  const missing = targets.filter((target) => !androidHermesDir(process.env, undefined, target));
  if (missing.length || !hermesBundle().installed) {
    run("cargo", [`+${channel}`, "run", "--locked", "--manifest-path",
      "vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml", "--",
      ...missing.flatMap((target) => ["--target", target])], sdk, env);
  }
}

async function prepare(sdk, app, args) {
  if (args.some((flag) => ["--help", "-h"].includes(flag))) return;
  if (!["dev", "web", "web-build", "android"].includes(args[0])) return;
  const cargoBin = resolve(process.env.CARGO_HOME || resolve(homedir(), ".cargo"), "bin");
  process.env.PATH = [cargoBin, process.env.PATH].join(delimiter);
  if (args[0] === "android") return prepareAndroid(sdk, app, args);
  const cli = resolve(sdk, "scripts/exact.mjs");
  const env = { ...process.env, EXACT_APP_DIR: app };
  const check = spawnSync(process.execPath, [cli, "setup", "--check", "--platform", "web"], { cwd: sdk, env });
  if (check.status === 0) return;
  const { prebuiltWebTools } = await import(resolve(sdk, "scripts/tools.mjs"));
  const { resolveApp } = await import(resolve(sdk, "scripts/app.mjs"));
  const { webCompilesRust } = await import(resolve(sdk, "scripts/app-shells.mjs"));
  if (webCompilesRust(resolveApp(app, { useOutput: false })) || !prebuiltWebTools?.({ download: true })) ensureRust();
  run(process.execPath, [cli, "setup", "--platform", "web"], sdk, env);
}

async function main(args) {
  if (args[0] === "install-cli") return installCli();
  if (basename(import.meta.path) === "exact") {
    const wrapper = projectWrapper();
    const cli = wrapper ?? resolve(checkout(), "scripts/exact.mjs");
    return launch(cli, args, process.cwd(), process.env);
  }
  const app = realpathSync(resolve(import.meta.dir, "../apps/apps"));
  const sdk = checkout(app);
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

  await prepare(sdk, app, args);
  return launch(resolve(app, "exact.mjs"), args, app, { ...process.env, EXACT: sdk });
}

async function launch(cli, args, cwd, env) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: "inherit" });
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
