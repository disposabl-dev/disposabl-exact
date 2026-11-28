import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const defaultOrigin = "https://www.disposabl.dev";

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

async function runCli(directory, origin, args, signal, interactive = false) {
  signal.throwIfAborted();
  const require = createRequire(join(directory, "package.json"));
  const manifest = require.resolve("@disposabl/cli/package.json");
  const cli = join(dirname(manifest), require(manifest).bin.disposabl);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: directory,
      signal,
      env: { ...process.env, DISPOSABL_API_ORIGIN: origin },
      stdio: interactive ? "inherit" : ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error('Disposabl setup failed at "' + args.slice(0, args.includes("--appSlug") ? 2 : 3).join(" ") + '".'));
    });
  });
  if (interactive) return;
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Disposabl setup returned an invalid response.");
  }
}

function githubRepository(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-z0-9-]+\/[a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url);
  return match?.[1].toLowerCase();
}

function configureRemote(directory, app) {
  if (typeof app.githubOwner !== "string" || typeof app.githubRepoName !== "string") {
    throw new Error("Disposabl did not return the app's GitHub repository.");
  }
  const repository = app.githubOwner + "/" + app.githubRepoName;
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repository)) {
    throw new Error("Disposabl returned an invalid GitHub repository.");
  }
  const remotes = git(directory, "remote").split("\n");
  if (remotes.includes("origin")) {
    if (githubRepository(git(directory, "config", "--get", "remote.origin.url")) !== repository.toLowerCase()) {
      throw new Error("The existing origin belongs to a different repository.");
    }
  } else {
    git(directory, "remote", "add", "origin", "https://github.com/" + repository + ".git");
  }
  return repository;
}

function openBrowser(url) {
  const [command, ...args] = process.platform === "darwin" ? ["open"] :
    process.platform === "win32" ? ["rundll32.exe", "url.dll,FileProtocolHandler"] : ["xdg-open"];
  const child = spawn(command, [...args, url], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

async function connect(run, terminal, signal, provider, label, authorizationOrigin) {
  const status = () => run(["connections", provider, "status"]);
  if ((await status()).connected) {
    terminal.progress(label + " connected.");
    return;
  }

  const { url } = await run(["connections", provider, "connect", "--no-browser"]);
  const authorization = typeof url === "string" ? URL.parse(url) : null;
  if (!authorization || authorization.origin !== authorizationOrigin || authorization.username || authorization.password) {
    throw new Error("Disposabl returned an invalid " + label + " authorization link.");
  }

  terminal.progress("Open this link to connect " + label + ".\n" + authorization.href);
  if (!terminal.interactive) {
    throw new Error("Setup paused. Open the link, finish connecting " + label + ", then resume.");
  }
  openBrowser(authorization.href);
  terminal.progress("Waiting for " + label + ". Press Ctrl+C to pause.");
  const expiresAt = Date.now() + 10 * 60_000;
  while (Date.now() < expiresAt) {
    await delay(2_000, undefined, { signal });
    if ((await status()).connected) {
      terminal.progress(label + " connected.");
      return;
    }
  }
  throw new Error(label + " connection timed out. Resume to check again.");
}

export async function setup(directory, name, config, terminal, signal) {
  const origin = process.env.DISPOSABL_API_ORIGIN || defaultOrigin;
  if (config.serviceOrigin && config.serviceOrigin !== origin) {
    throw new Error("Set DISPOSABL_API_ORIGIN to the original Disposabl API origin before resuming.");
  }

  const run = (args, interactive) => runCli(directory, origin, args, signal, interactive);
  terminal.progress("[1/4] Check Disposabl sign-in");
  if (!(await run(["login", "status"])).currentUser) {
    terminal.progress("Sign in in your browser, then return here to continue. Press Ctrl+C to pause.");
    await run(terminal.interactive ? ["login"] : ["login", "--no-browser"], true);
    if (!(await run(["login", "status"])).currentUser) throw new Error("Disposabl login did not complete.");
  }
  terminal.progress("Signed in to Disposabl.");

  terminal.progress("[2/4] Connect GitHub");
  await connect(run, terminal, signal, "github", "GitHub", "https://github.com");
  terminal.progress("[3/4] Connect Convex");
  await connect(run, terminal, signal, "convex", "Convex", "https://dashboard.convex.dev");

  terminal.progress("[4/4] Provision your GitHub repository and Convex project");
  const app = await run(["apps", "create", "--appSlug", name, "--appName", name]);
  if (app.appSlug !== name || typeof app.appId !== "string" || !app.appId) {
    throw new Error("Disposabl did not return the expected app ID.");
  }
  if (config.appId && config.appId !== app.appId) {
    throw new Error("This project is linked to a different Disposabl app.");
  }

  config.appId = app.appId;
  config.serviceOrigin = origin;
  if (typeof app.convexSiteUrl === "string" && /^https:\/\/[a-z0-9-]+\.convex\.site$/.test(app.convexSiteUrl)) {
    config.apiOrigin = app.convexSiteUrl;
  }
  await writeJson(join(directory, "disposabl.json"), config);
  const repository = configureRemote(directory, app);
  terminal.progress("App linked to " + repository + ". App ID saved in disposabl.json.");
}
