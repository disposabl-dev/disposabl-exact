import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const backend = resolve(root, "packages/backend");

if (process.argv[2] === "web") {
  // Convex starts this process in the backend directory after its first successful push.
  const { CONVEX_URL, CONVEX_SITE_URL } = process.env;
  if (!CONVEX_URL || !CONVEX_SITE_URL) throw new Error("Convex dev did not provide its development URLs.");
  const env = { ...process.env };
  env.CONVEX_ORIGIN = CONVEX_URL.replace(/^http/, "ws");
  env.CONVEX_SITE_ORIGIN = CONVEX_SITE_URL;
  for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_DEPLOYMENT"]) delete env[key];
  process.chdir(root);
  process.execve(process.execPath, [process.execPath, "scripts/exact.mjs", "web"], env);
} else {
  const { platforms } = await Bun.file(resolve(root, "disposabl.json")).json();
  const args = [process.execPath, "run", "dev"];
  if (platforms.some(platform => ["web", "android", "ios", "macos"].includes(platform))) {
    args.push("--start", "bun ../../scripts/dev.mjs web");
  }
  process.chdir(backend);
  process.execve(process.execPath, args, { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" });
}
