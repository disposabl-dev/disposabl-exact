import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { Bumper } from "conventional-recommended-bump";
import semver from "semver";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

export async function releaseVersion(latest, head, cwd = process.cwd()) {
  const version = semver.parse(latest.version);
  if (!version || version.version !== latest.version || version.prerelease.length) {
    throw new Error(`Expected a stable latest version, got ${latest.version}`);
  }
  if (latest.repository?.url !== manifest.repository.url) throw new Error("Unexpected repository on npm latest");
  if (![head, latest.gitHead].every(sha => /^[0-9a-f]{40}$/.test(sha))) throw new Error("Missing release commit");
  if (head === latest.gitHead) return latest.version;

  execFileSync("git", ["merge-base", "--is-ancestor", latest.gitHead, head], { cwd });
  const recommendation = await new Bumper(cwd).loadPreset("conventionalcommits")
    .tag(latest.gitHead).commits({ to: head }).bump();
  return semver.inc(latest.version, recommendation.releaseType ?? "patch");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const response = await fetch(`https://registry.npmjs.org/${manifest.name}/latest`);
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  console.log(await releaseVersion(await response.json(), execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()));
}
