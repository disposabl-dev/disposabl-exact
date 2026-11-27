import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const previousRepository = "git+https://github.com/disposabl-dev/create-disposabl-app.git";

function commitsSince(base, head) {
  execFileSync("git", ["merge-base", "--is-ancestor", base, head]);
  return execFileSync("git", ["log", "-z", "--format=%B", `${base}..${head}`], { encoding: "utf8" }).split("\0");
}

export function releaseVersion(latest, head, history = commitsSince) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(latest.version)) throw new Error(`Expected a stable latest version, got ${latest.version}`);
  if (latest.repository?.url === previousRepository && latest.version.startsWith("0.")) return manifest.version;
  if (latest.repository?.url !== manifest.repository.url) throw new Error("Unexpected repository on npm latest");
  if (![head, latest.gitHead].every(sha => /^[0-9a-f]{40}$/.test(sha))) throw new Error("Missing release commit");
  if (head === latest.gitHead) return latest.version;

  const messages = history(latest.gitHead, head);
  const [major, minor, patch] = latest.version.split(".").map(BigInt);
  if (messages.some(message => /^[\w-]+(?:\([^()\n]+\))?!: /.test(message) || /^BREAKING[ -]CHANGE: /m.test(message))) {
    return `${major + 1n}.0.0`;
  }
  if (messages.some(message => /^feat(?:\([^()\n]+\))?: /.test(message))) return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const response = await fetch(`https://registry.npmjs.org/${manifest.name}/latest`);
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  console.log(releaseVersion(await response.json(), execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()));
}
