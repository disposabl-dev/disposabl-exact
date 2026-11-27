import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "tar";

export const starterRef = (await readFile(new URL("./starter.ref", import.meta.url), "utf8")).trim();
const root = join(import.meta.dirname, "../..");
const starterPaths = ["apps/apps", "packages/backend", "packages/package.json", "packages/bun.lock"];
const removedDemoFiles = new Set([
  "apps/apps/app.test.contract",
  "packages/backend/convex/README.md",
  "packages/backend/convex/counter.ts",
  "packages/backend/convex/myFunctions.ts",
]);
const cleanupPatch = join(import.meta.dirname, "starter-cleanup.patch");

export async function resetApp(directory) {
  if (!/^[a-f0-9]{40}$/.test(starterRef)) {
    throw new Error("starter.ref must contain a full Git commit SHA.");
  }
  await mkdir(directory);
  const archive = join(directory, ".starter.tar");
  try {
    execFileSync("git", ["archive", "--format=tar", "--output", archive, starterRef, "--", ...starterPaths], {
      cwd: root, stdio: "inherit",
    });
    await extract({ file: archive, cwd: directory, strict: true, filter: file => !removedDemoFiles.has(file) });
    execFileSync("git", ["apply", "--unidiff-zero", cleanupPatch], { cwd: directory, stdio: "inherit" });
    return execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", starterRef, "--", ...starterPaths], {
      cwd: root, encoding: "utf8",
    }).split("\0").filter(file => file && !removedDemoFiles.has(file));
  } finally {
    await rm(archive, { force: true });
  }
}

if (import.meta.main || process.argv[1] === import.meta.filename) {
  const output = await mkdtemp(join(tmpdir(), "exact-reset-app-"));
  try {
    await resetApp(join(output, "starter"));
    console.log(join(output, "starter"));
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
