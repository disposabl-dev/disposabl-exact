import { $ } from "bun";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { platform } from "../../disposabl-kit/server/platform";

const root = resolve(import.meta.dir, "../../..");
const configPath = resolve(root, "disposabl.json");
const fixture = resolve(root, "packages/backend/convex/clientTest.ts");
const profiles = {
  "auth-off": { extra: [], features: [] },
  "auth-on": { extra: ["web"], features: ["authentication"] },
  payments: { extra: ["mcp"], features: ["authentication", "payments"] },
} as const;

const [profile = "configured", output] = Bun.argv.slice(2);
const check = profiles[profile as keyof typeof profiles];
if (profile !== "configured" && !check)
  throw new Error(`Unknown client profile ${profile}`);
if (!output) throw new Error("Specify an artifact directory.");
if (platform.packages.length === 0) process.exit(0);

const original = await readFile(configPath, "utf8");
const env = {
  ...process.env,
  CONVEX_AGENT_MODE: "anonymous",
  CLIENT_TEST_OUTPUT: resolve(output),
  CLIENT_TEST_FIXTURE: check ? "1" : "0",
};
delete env.CONVEX_DEPLOY_KEY;
let installedFixture = false;
try {
  if (check) {
    const originalPlatforms = JSON.parse(original).platforms as string[];
    const clientPlatforms = originalPlatforms.filter(
      (id) => id === "cli" || id === "typescript-sdk",
    );
    const config = {
      platforms: [...check.extra, ...clientPlatforms],
      features: check.features,
    };
    platform.read(config);
    await writeFile(
      fixture,
      await readFile(resolve(import.meta.dir, "fixtures/clientOperations.ts")),
      { flag: "wx" },
    );
    installedFixture = true;
    await writeFile(configPath, JSON.stringify(config));
  }

  await $`bun install --cwd packages/backend --frozen-lockfile`.cwd(root);
  if (platform.packages.includes("sdk"))
    await $`bun install --cwd packages/sdk --frozen-lockfile`.cwd(root);
  await $`bun run --cwd packages/backend dev --once --codegen disable --start 'bun --env-file=.env.local test ./tests/clients.e2e.ts'`
    .cwd(root)
    .env(env);
} finally {
  if (installedFixture) {
    await writeFile(configPath, original);
    await rm(fixture, { force: true });
    await $`bun run --cwd packages/backend generate:platforms`.cwd(root);
  }
}
