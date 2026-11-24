import { watch } from "node:fs";
import { convex, generatePlatforms } from "./generate-platforms";

try {
  await import("./project-config.mjs");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let pending = Promise.resolve();
let timer: ReturnType<typeof setTimeout>;
const watcher = watch(convex, { recursive: true }, (_event, path) => {
  if (path?.startsWith("_generated/")) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    pending = pending.then(generatePlatforms).catch((error: unknown) => {
      console.error("Could not update platform functions:", error);
    });
  }, 40);
});

try {
  await generatePlatforms();
  const child = Bun.spawn(["bunx", "--no-install", "convex", "dev", ...Bun.argv.slice(2)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.exitCode = await child.exited;
} finally {
  watcher.close();
  clearTimeout(timer);
  await pending;
}
