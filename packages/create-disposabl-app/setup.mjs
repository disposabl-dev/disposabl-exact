import { execFileSync } from "node:child_process";
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

async function connect(client, terminal, signal, provider, label, providerLink, openUrl) {
  const path = "/api/connections/" + provider;
  const status = () => client.request(path + "/status", { signal }, true);
  if ((await status()).connected) return terminal.progress(label + " connected.");

  const { url } = await client.request(path + "/connect", { method: "POST", signal }, true);
  const link = providerLink(provider, url);
  terminal.progress("Open this link to connect " + label + ".\n" + link);
  if (!terminal.interactive) throw new Error("Setup paused. Open the link, finish connecting " + label + ", then resume.");
  openUrl(link);

  terminal.progress("Waiting for " + label + ". Press Ctrl+C to pause.");
  const expiresAt = Date.now() + 10 * 60_000;
  while (Date.now() < expiresAt) {
    await delay(2_000, undefined, { signal });
    if ((await status()).connected) return terminal.progress(label + " connected.");
  }
  throw new Error(label + " connection timed out. Resume to check again.");
}

export async function setup(directory, name, config, terminal, signal) {
  const require = createRequire(join(directory, "package.json"));
  const cli = dirname(require.resolve("@disposabl/cli/package.json"));
  const { createClient, providerLink } = await import(join(cli, "client.mjs"));
  const { sandboxSession } = await import(join(cli, "sandbox.mjs"));
  const { openUrl } = await import(join(cli, "auth.mjs"));
  const client = createClient(process.env.DISPOSABL_API_ORIGIN || sandboxSession()?.origin || defaultOrigin);
  if (config.serviceOrigin && config.serviceOrigin !== client.origin) {
    throw new Error("Set DISPOSABL_API_ORIGIN to the original Disposabl API origin before resuming.");
  }

  terminal.progress("[1/4] Check Disposabl sign-in");
  if (!await client.currentUser({ signal })) {
    terminal.progress("Sign in in your browser, then return here to continue. Press Ctrl+C to pause.");
    await client.signIn(terminal.interactive);
    if (!await client.currentUser({ signal })) throw new Error("Disposabl login did not complete.");
  }
  terminal.progress("Signed in to Disposabl.");

  terminal.progress("[2/4] Connect GitHub");
  await connect(client, terminal, signal, "github", "GitHub", providerLink, openUrl);
  terminal.progress("[3/4] Connect Convex");
  await connect(client, terminal, signal, "convex", "Convex", providerLink, openUrl);

  terminal.progress("[4/4] Provision your GitHub repository and Convex project");
  const app = await client.request("/api/apps/create", {
    method: "POST", signal, timeout: 120_000,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appSlug: name, appName: name }),
  }, true);
  if (app.appSlug !== name || typeof app.appId !== "string" || !app.appId) {
    throw new Error("Disposabl did not return the expected app ID.");
  }
  if (config.appId && config.appId !== app.appId) {
    throw new Error("This project is linked to a different Disposabl app.");
  }

  config.appId = app.appId;
  config.serviceOrigin = client.origin;
  if (typeof app.convexSiteUrl === "string" && /^https:\/\/[a-z0-9-]+\.convex\.site$/.test(app.convexSiteUrl)) {
    config.apiOrigin = app.convexSiteUrl;
  }
  await writeJson(join(directory, "disposabl.json"), config);
  const repository = configureRemote(directory, app);
  terminal.progress("App linked to " + repository + ". App ID saved in disposabl.json.");
}
