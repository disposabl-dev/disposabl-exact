import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create } from "tar";
import { resetApp } from "./reset-app.mjs";

const root = join(import.meta.dirname, "../..");
const templatePaths = [
  "README.md", "packages/.gitignore", "packages/disposabl-kit", "packages/cli", "packages/sdk",
  ".github/ci/android-key.sh", ".github/ci/update-key.sh",
];

const temporary = await realpath(await mkdtemp(join(tmpdir(), "exact-starter-")));
const stage = join(temporary, "template");
try {
  const restored = join(temporary, "starter");
  const appFiles = await resetApp(restored);
  const sharedFiles = execFileSync("git", ["ls-files", "-z", "--", ...templatePaths], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean);
  const sources = new Map([
    [".github/workflows/deploy.yml", join(import.meta.dirname, "templates/deploy.yml")],
    ["disposabl.json", join(import.meta.dirname, "disposabl.json")],
    ...sharedFiles.map(file => [file, join(root, file)]),
    ...appFiles.map(file => [file, join(restored, file)]),
  ]);
  const selected = new Set(sources.values());
  const files = [...sources.keys()].sort();
  for (const file of files) {
    const source = await realpath(sources.get(file));
    if (!selected.has(source)) throw new Error(`Template file references an excluded path: ${file}`);
    const destination = join(stage, file);
    if (!(await stat(source)).isFile()) throw new Error(`Template entry must be a regular file: ${file}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await create({
    cwd: stage, file: join(import.meta.dirname, "template.tar.gz"), gzip: true,
    portable: true, noMtime: true, strict: true,
  }, files);
  await copyFile(join(root, "packages/disposabl-kit/server/platform-config.mjs"),
    join(import.meta.dirname, "platform-config.mjs"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
