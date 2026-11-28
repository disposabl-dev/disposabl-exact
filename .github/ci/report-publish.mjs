const { DISPOSABL_PUBLISH_KEY: key, GITHUB_SHA: commitSha, RUNNER_TEMP } = process.env;
if (!key) process.exit(0);

const [platform, site] = process.argv.slice(2);
const { serviceOrigin } = await Bun.file("disposabl.json").json();
const origin = new URL(serviceOrigin);
if (origin.protocol !== "https:" || origin.href !== origin.origin + "/") {
  throw new Error("Expected an HTTPS Disposabl service origin.");
}
const installer = Bun.file(`${RUNNER_TEMP}/installer-${platform}.json`);
const url = site || (platform !== "web" && await installer.exists() ? (await installer.json()).url : undefined);
const response = await fetch(new URL("/api/apps/publish", origin), {
  method: "POST",
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ platform, commitSha, url }),
});
if (!response.ok) throw new Error(`Could not record the Disposabl publish result (HTTP ${response.status}).`);
