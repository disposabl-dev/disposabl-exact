import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const { platforms } = await Bun.file(resolve(root, "disposabl.json")).json();
const args = [process.execPath, "run", "dev"];
if (platforms.some(platform => ["web", "android", "ios", "macos"].includes(platform))) {
  args.push("--start", "bun --no-env-file ../../scripts/exact.mjs web");
}
process.chdir(resolve(root, "packages/backend"));
process.execve(process.execPath, args, { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" });
