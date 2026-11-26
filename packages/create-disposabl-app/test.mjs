import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseEnv, promisify } from "node:util";
import { parseDocument } from "yaml";

const exec = promisify(execFile);
const packageDir = import.meta.dirname;
const appId = "00000000-0000-4000-8000-000000000001";
const repositoryUrl = "https://github.com/example/exact-demo.git";
const deployKey = "dev:test-deployment|fixture-key";
const convexUrl = "https://test-deployment.convex.cloud";
const convexSiteUrl = "https://test-deployment.convex.site";

const features = { type: "array", items: { type: "string" } };
const schema = properties => ({ content: { "application/json": { schema: { type: "object", properties } } } });
const text = { type: "string" };
const contract = {
  paths: {
    "/api/connections/status": { get: { parameters: [{ name: "features", content: { "application/json": { schema: features } } }] } },
    "/api/apps/create": { post: { requestBody: schema({ name: text, platforms: features, features }) } },
    "/api/previews/token/create": { post: { requestBody: schema({ appId: text, reference: text, platforms: features, features }) } },
  },
};

test("the packed generator uses the published CLI for web setup and enables Exact mobile afterward", async t => {
  const work = await mkdtemp(join(tmpdir(), "create-disposabl-app-test-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const [{ filename, files }] = JSON.parse(execFileSync("npm", [
    "pack", "--ignore-scripts", "--json", "--pack-destination", work,
  ], { cwd: packageDir, encoding: "utf8" }));
  assert.ok(files.some(file => file.path === "template.tar.gz"));
  assert.ok(!files.some(file => file.path === "build.mjs"));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(work, filename)], { cwd: work });

  const cli = join(work, "node_modules/create-disposabl-app/index.mjs");
  const scaffold = (name, flags, env = {}) =>
    exec(process.execPath, [cli, name, ...flags], { cwd: work, env: { ...process.env, ...env } });
  const directory = join(work, "exact-demo");
  const read = file => readFile(join(directory, file), "utf8");
  const config = async () => JSON.parse(await read("disposabl.json"));

  let failSetup = true;
  let creations = 0;
  const calls = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Content-Type", "application/json");
    const send = value => response.end(JSON.stringify(value));
    if (url.pathname === "/openapi.json") return send(contract);
    calls.push(url.pathname);
    if (url.pathname === "/api/users/current") return send({ id: "fake-user" });
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = body ? JSON.parse(body) : Object.fromEntries([...url.searchParams].map(([key, value]) => [key, JSON.parse(value)]));
    if (url.pathname === "/api/connections/status") {
      return send({ ready: !("mobile" in input) });
    }
    if (JSON.stringify(input.platforms) !== '["web"]') {
      response.statusCode = 400;
      return send({ error: "Only web can use legacy provider setup" });
    }
    if (url.pathname === "/api/apps/create") {
      creations += 1;
      return send({ appId });
    }
    if (failSetup) {
      response.statusCode = 503;
      return send({ error: "Temporary test failure" });
    }
    return send({
      appId, name: "test-deployment", deployKey, convexUrl, convexSiteUrl, repositoryUrl,
      productionConvexSiteUrl: "https://test-production.convex.site",
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = {
    DISPOSABL_API_ORIGIN: `http://127.0.0.1:${server.address().port}`,
    DISPOSABL_API_KEY: "fixture-key",
    DISPOSABL_CONFIG_DIR: join(work, "cli-config"),
    DO_NOT_TRACK: "1",
  };

  await assert.rejects(scaffold("exact-demo", [], env), /--resume/);
  assert.deepEqual((await config()).platforms, ["web"]);
  assert.equal((await config()).appId, appId);
  assert.equal(creations, 1);
  failSetup = false;
  const result = await scaffold("exact-demo", ["--resume"], env);
  assert.ok(!result.stdout.includes(deployKey) && !result.stderr.includes(deployKey));
  assert.equal(creations, 1);
  assert.deepEqual((await config()).platforms, ["web", "android", "ios"]);
  assert.deepEqual((await config()).features, ["authentication"]);
  const mobile = execFileSync("bun", ["--print", 'JSON.stringify((await import("./packages/disposabl-kit/server/platform.ts")).platform.mobile)'], {
    cwd: directory, encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(mobile), ["android", "ios"]);
  assert.equal(execFileSync("git", ["remote", "get-url", "origin"], { cwd: directory, encoding: "utf8" }).trim(), repositoryUrl);
  assert.equal(parseEnv(await read("packages/backend/.env.local")).CONVEX_DEPLOY_KEY, deployKey);
  assert.deepEqual(parseEnv(await read("apps/apps/.env.local")), {
    CONVEX_ORIGIN: "wss://test-deployment.convex.cloud",
    CONVEX_SITE_ORIGIN: convexSiteUrl,
  });
  execFileSync("git", ["check-ignore", "--quiet", "apps/apps/.env.local"], { cwd: directory });
  execFileSync("git", ["check-ignore", "--quiet", "packages/backend/.env.local"], { cwd: directory });
  assert.deepEqual(calls, [
    "/api/users/current", "/api/connections/status", "/api/apps/create", "/api/previews/token/create",
    "/api/users/current", "/api/connections/status", "/api/previews/token/create",
  ]);

  const app = JSON.parse(await read("apps/apps/app.json"));
  assert.equal(app.name, "exact-demo");
  assert.match(app.host.android.id, /^dev\.disposabl\.app\.a[a-z0-9]+$/);
  assert.equal(app.app.id, app.host.android.id);
  const deploy = parseDocument(await read(".github/workflows/deploy.yml"));
  assert.deepEqual(deploy.errors, []);
  assert.equal(deploy.hasIn(["jobs", "publish"]), false);
  assert.deepEqual(deploy.getIn(["jobs", "tools", "needs"]).toJSON(), ["config"]);
  assert.equal(deploy.hasIn(["jobs", "native"]), true);
  assert.equal(deploy.hasIn(["jobs", "provision-signing"]), true);
  for (const excluded of ["apps/web", "apps/mobile", ".github/workflows/publish.yml",
    ".github/workflows/create-disposabl-app.yml", ".github/actions/exact-setup/scripts/publish-inputs.sh",
    "packages/create-disposabl-app"]) {
    await assert.rejects(access(join(directory, excluded)), { code: "ENOENT" });
  }
  await access(join(directory, ".github/actions/exact-setup/scripts/publish-installer.sh"));
  await access(join(directory, "apps/apps/.gitignore"));

  const priorCalls = calls.length;
  await exec("npm", ["exec", "--", "create-disposabl-app", "offline-app", "--skip-setup"], {
    cwd: work, env: { ...process.env, ...env },
  });
  assert.equal(calls.length, priorCalls);
  const offline = JSON.parse(await readFile(join(work, "offline-app/disposabl.json"), "utf8"));
  assert.deepEqual(offline.platforms, ["web", "android", "ios"]);
  await assert.rejects(scaffold("offline-app", ["--skip-setup"], env), /EEXIST/);
});
