import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create } from "tar";
import { parseDocument } from "yaml";
import { resetApp } from "./reset-app.mjs";

const root = join(import.meta.dirname, "../..");
const deployPath = ".github/workflows/deploy.yml";
const actionPath = ".github/actions/exact-setup/action.yml";
const templatePaths = [
  "README.md", "disposabl.json", "packages/.gitignore",
  "packages/disposabl-kit", "packages/cli", "packages/sdk",
  ".github/workflows/app-config.yml", ".github/workflows/clients.yml", deployPath,
  ".github/actions/exact-setup",
];
const publisherScripts = new Set([
  "setup.sh", "pack.sh", "publish-inputs.sh",
  "android-compiler-cache.sh", "ios-compiler-cache.sh",
  "ios-host-catalog-publish.sh", "ios-link-kit-publish.sh",
]);

function readYaml(source) {
  const document = parseDocument(source);
  if (document.errors.length) throw new AggregateError(document.errors, "Invalid template YAML");
  return document;
}

function appDeploy(source) {
  const deploy = readYaml(source);
  if (!deploy.deleteIn(["jobs", "publish"])) throw new Error("Missing Exact tools publisher job");
  deploy.setIn(["jobs", "tools", "needs"], ["config"]);
  deploy.setIn(["jobs", "tools", "if"],
    "needs.config.result == 'success' && needs.config.outputs.frontend == 'true'");
  const verify = deploy.getIn(["jobs", "tools", "steps", 1]);
  verify.deleteIn(["env", "WAIT_SECONDS"]);
  verify.set("run", verify.get("run").replace(/ \\\n\s*--wait "\$WAIT_SECONDS"/, ""));
  deploy.setIn(["jobs", "deploy", "if"],
    "!cancelled() && needs.config.result == 'success' && (needs.tools.result == 'success' || " +
    "(needs.config.outputs.frontend != 'true' && needs.tools.result == 'skipped'))");
  const output = deploy.toString({ lineWidth: 0 });
  if (output.includes("disposabl-dev/disposabl-exact") || output.includes("needs.publish")) {
    throw new Error("Generated deploy workflow still has Exact publisher logic");
  }
  return output;
}

function appSetupAction(source) {
  const action = readYaml(source);
  action.set("description", "Install pinned Exact tools for the selected runner");
  action.deleteIn(["inputs", "mode"]);
  const steps = action.getIn(["runs", "steps"]);
  steps.items = steps.items.filter(step => step.get("name") !== "Build bundle");
  for (const step of steps.items) {
    const condition = step.get("if");
    if (condition === "inputs.mode == 'consume'") {
      step.delete("if");
    } else if (typeof condition === "string" && condition.includes("inputs.mode")) {
      step.set("if", condition.replace("inputs.mode == 'build' || ", "").replace("inputs.mode == 'consume' && ", ""));
    }
  }
  const checkout = steps.items.find(step => step.get("id") === "checkout-exact");
  checkout.deleteIn(["env", "SETUP_MODE"]);
  checkout.set("run", checkout.get("run")
    .replace('[[ "$SETUP_MODE" =~ ^(consume|build)$ ]]\n', "")
    .replace('$SETUP_MODE" != consume || "$SETUP_BUNDLE_VERSION', '$SETUP_BUNDLE_VERSION')
    .replace('"$SETUP_MODE" == build || ', ""));
  const output = action.toString({ lineWidth: 0 });
  if (output.includes("inputs.mode") || output.includes("SETUP_MODE") || output.includes("/pack.sh")) {
    throw new Error("Generated setup action still has Exact publisher logic");
  }
  return output;
}

const temporary = await realpath(await mkdtemp(join(tmpdir(), "exact-starter-")));
const stage = join(temporary, "template");
try {
  const restored = join(temporary, "starter");
  const appFiles = await resetApp(restored);
  const sharedFiles = execFileSync("git", ["ls-files", "-z", "--", ...templatePaths], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean).filter(file =>
      !file.startsWith(".github/actions/exact-setup/scripts/") || !publisherScripts.has(file.split("/").at(-1)));
  const sources = new Map([
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
    if (file === deployPath || file === actionPath) {
      const transform = file === deployPath ? appDeploy : appSetupAction;
      await writeFile(destination, transform(await readFile(source, "utf8")));
    } else if (file === "README.md") {
      const readme = await readFile(source, "utf8");
      await writeFile(destination, readme.replace(
        /^Change the Exact SHA in .*Ordinary app changes reuse the release for the current pin\.$/m,
        "Deployment downloads the published Exact tools and compiler caches for the revision in [pin.env](.github/actions/exact-setup/pin.env).",
      ));
    } else {
      await copyFile(source, destination);
    }
  }
  await create({
    cwd: stage, file: join(import.meta.dirname, "template.tar.gz"), gzip: true,
    portable: true, noMtime: true, strict: true,
  }, files);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
