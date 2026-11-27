#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { extract } from "tar";
import lockfile from "proper-lockfile";
import { features, platforms, readProjectConfig } from "./platform-config.mjs";
import { git, readJson, setup, writeJson } from "./setup.mjs";

const help = `Usage: create-disposabl-app [app-name] [options]

Create an Exact and Convex project. Web and authentication are the defaults.
Setup uses @disposabl/cli to provision GitHub and Convex.

  --platforms  Comma-separated list of ${platforms.join(", ")}.
  --features   Comma-separated list of ${features.join(", ")}.
  --skip-setup  Generate files and skip account and provider setup.
  --resume      Continue provider setup with the existing disposabl.json.
  --version     Show the generator version.
  --help        Show this message.`;

async function getName(positionals) {
  if (positionals.length === 0 && process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      positionals.push((await prompt.question("App name: ")).trim());
    } finally {
      prompt.close();
    }
  }
  const [name] = positionals;
  if (positionals.length !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 55) {
    throw new Error("Provide an app name of up to 55 lowercase letters, numbers and hyphens.");
  }
  return name;
}

async function setNativeCallback(directory, id) {
  const original = "dev.disposabl.exact:/oauth/google";
  const callback = id + ":/oauth/google";
  for (const file of ["apps/apps/auth.ts", "packages/disposabl-kit/server/authSettings.ts"]) {
    const path = join(directory, file);
    const source = await readFile(path, "utf8");
    if (!source.includes(original)) throw new Error("Missing native callback in " + file);
    await writeFile(path, source.replace(original, callback));
  }
}

function parseSelection(value) {
  return value.trim() === "" || value.trim() === "none" ? [] : value.split(",").map(item => item.trim());
}

async function selectConfig(path, options) {
  const config = await readJson(path);
  let prompt;
  try {
    for (const [key, choices] of [["platforms", platforms], ["features", features]]) {
      if (options[key] !== undefined) {
        config[key] = parseSelection(options[key]);
      } else if (process.stdin.isTTY) {
        prompt ??= createInterface({ input: process.stdin, output: process.stdout });
        const answer = await prompt.question(`Choose ${key} (${choices.join(", ")} or none) [${config[key].join(", ")}]: `);
        if (answer.trim()) config[key] = parseSelection(answer);
      }
    }
  } finally {
    prompt?.close();
  }
  readProjectConfig(config);
  await writeJson(path, config);
}

async function createProject(directory, name, options) {
  await mkdir(directory);
  try {
    await extract({ cwd: directory, file: join(import.meta.dirname, "template.tar.gz"), strict: true });
    await selectConfig(join(directory, "disposabl.json"), options);
    const appPath = join(directory, "apps/apps/app.json");
    const app = await readJson(appPath);
    const id = `dev.disposabl.app.a${name.replaceAll("-", "")}${randomBytes(4).toString("hex")}`;
    app.id = app.app.id = app.host.android.id = id;
    app.name = app.short_name = app.app.name = name;
    app.variants.preview.name = `${name} Preview`;
    await writeJson(appPath, app);
    await setNativeCallback(directory, id);
    git(directory, "init", "--quiet", "--initial-branch=main");
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
      "skip-setup": { type: "boolean" },
      resume: { type: "boolean" },
      platforms: { type: "string" },
      features: { type: "string" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (values.version) {
    console.log((await readJson(new URL("./package.json", import.meta.url))).version);
    return;
  }
  if (values.resume && values["skip-setup"]) throw new Error("Choose either --resume or --skip-setup.");
  if (values.resume && (values.platforms !== undefined || values.features !== undefined)) {
    throw new Error("Edit disposabl.json before resuming setup.");
  }
  const name = await getName(positionals);
  const directory = resolve(name);
  if (!values.resume) await createProject(directory, name, values);
  const configPath = join(directory, "disposabl.json");
  const app = await readJson(join(directory, "apps/apps/app.json"));
  if (!app.id.startsWith("dev.disposabl.app.") || resolve(git(directory, "rev-parse", "--show-toplevel")) !== directory) {
    throw new Error("Resume setup from the parent directory of a generated project.");
  }
  const release = await lockfile.lock(configPath, {
    lockfilePath: join(git(directory, "rev-parse", "--absolute-git-dir"), "disposabl-setup.lock"),
  });
  try {
    const config = await readJson(configPath);
    readProjectConfig(config);
    if (!values["skip-setup"]) await setup(directory, app.name, config);
  } catch (error) {
    throw new Error(`${error.message}\nFiles are in ${directory}. Rerun the generator with --resume.`);
  } finally {
    await release();
  }
  console.log(`Created ${directory}\nSee README.md for local development and deployment.`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
