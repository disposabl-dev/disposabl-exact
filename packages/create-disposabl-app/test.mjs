import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { list } from "tar";
import { starterRef } from "./reset-app.mjs";
import { parseDocument } from "yaml";

const exec = promisify(execFile);
const packageDir = import.meta.dirname;
const appId = "00000000-0000-4000-8000-000000000001";
const convexSiteUrl = "https://exact-demo.convex.site";
const repositoryUrl = "https://github.com/example/exact-demo.git";
const links = {
  github: "https://github.com/login/oauth/authorize?state=test",
  convex: "https://dashboard.convex.dev/oauth/authorize/team?state=test",
};
const fields = { appSlug: { type: "string" }, appName: { type: "string" } };
const contract = {
  paths: {
    ...Object.fromEntries(Object.keys(links).flatMap(provider => [
      ["/api/connections/" + provider + "/status", { get: {} }],
      ["/api/connections/" + provider + "/connect", { post: {} }],
    ])),
    "/api/apps/create": { post: { requestBody: { content: {
      "application/json": { schema: { type: "object", properties: fields, required: Object.keys(fields) } },
    } } } },
  },
};

test("the packed generator defaults to web and CLI and preserves selections through provider setup", async t => {
  const work = await mkdtemp(join(tmpdir(), "create-disposabl-app-test-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const archive = join(work, "generator.tgz");
  execFileSync("bun", ["pm", "pack", "--ignore-scripts", "--filename", archive], { cwd: packageDir });
  const files = new Set();
  await list({ file: archive, onReadEntry: entry => files.add(entry.path) });
  assert.ok(files.has("package/template.tar.gz"));
  assert.ok(files.has("package/platform-config.mjs"));
  assert.ok(!files.has("package/build.mjs"));
  assert.ok(!files.has("package/bun.lock"));
  assert.ok(!files.has("package/reset-app.mjs"));
  assert.ok(!files.has("package/starter.ref"));
  execFileSync("bun", ["add", "--ignore-scripts", archive], { cwd: work });
  const packed = JSON.parse(await readFile(join(work, "node_modules/create-disposabl-app/package.json"), "utf8"));
  const repository = "https://github.com/disposabl-dev/disposabl-exact";
  assert.equal(packed.dependencies["@disposabl/cli"], undefined);
  assert.equal(packed.repository.url, `git+${repository}.git`);
  assert.equal(packed.repository.directory, "packages/create-disposabl-app");
  assert.equal(packed.homepage, `${repository}/tree/main/packages/create-disposabl-app#readme`);
  assert.equal(packed.bugs.url, `${repository}/issues`);

  const cli = join(work, "node_modules/create-disposabl-app/index.mjs");
  const scaffold = (name, flags, env = {}) =>
    exec(process.execPath, [cli, name, ...flags], { cwd: work, env: { ...process.env, ...env } });
  const directory = join(work, "exact-demo");
  const read = file => readFile(join(directory, file), "utf8");
  const config = async () => JSON.parse(await read("disposabl.json"));

  const connected = { github: false, convex: false };
  let failCreate = true;
  let created = false;
  let holdGitHubStatus;
  const calls = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Content-Type", "application/json");
    const send = value => response.end(JSON.stringify(value));
    if (url.pathname === "/openapi.json") return send(contract);
    calls.push(url.pathname);
    if (url.pathname === "/api/users/current") return send({ id: "fake-user" });
    const connection = /^\/api\/connections\/(github|convex)\/(status|connect)$/.exec(url.pathname);
    if (connection) {
      const [, provider, command] = connection;
      if (provider === "github" && command === "status" && holdGitHubStatus) {
        holdGitHubStatus();
        return;
      }
      return send(command === "status" ? { connected: connected[provider] } : { url: links[provider] });
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    if (url.pathname !== "/api/apps/create" || !connected.github || !connected.convex ||
        input.appSlug !== "exact-demo" || input.appName !== "exact-demo") {
      response.statusCode = 400;
      return send({ error: "Expected both connections and the app slug and name" });
    }
    if (failCreate) {
      response.statusCode = 503;
      return send({ error: "Temporary test failure" });
    }
    created = true;
    return send({ appId, appSlug: input.appSlug, convexSiteUrl, githubOwner: "example", githubRepoName: "exact-demo" });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = {
    DISPOSABL_API_ORIGIN: `http://127.0.0.1:${server.address().port}`,
    DISPOSABL_API_KEY: "fixture-key",
    DISPOSABL_CONFIG_DIR: join(work, "cli-config"),
    DO_NOT_TRACK: "1",
  };

  const selected = { platforms: ["web", "android", "ios", "mcp"], features: ["authentication", "payments"] };
  await assert.rejects(scaffold("exact-demo", [
    "--platforms", selected.platforms.join(","), "--features", selected.features.join(","),
  ], env), error => error.stdout.includes(links.github) && error.stderr.includes("exact-demo --resume"));
  assert.deepEqual((await config()).platforms, selected.platforms);
  assert.deepEqual((await config()).features, selected.features);
  for (const name of ["gradle.lockfile", "gradle-verification.xml"]) {
    assert.equal(await read(`apps/apps/${name}`), await readFile(join(packageDir, `../../apps/apps/${name}`), "utf8"));
  }
  assert.equal((await config()).appId, undefined);
  assert.equal(JSON.parse(await read("package.json")).devDependencies["@disposabl/cli"], "file:packages/cli");
  await access(join(directory, "node_modules/.bin/disposabl"));
  for (const script of ["dev.mjs", "dev-web.mjs", "exact.mjs"]) await access(join(directory, "scripts", script));

  connected.github = true;
  await assert.rejects(scaffold("exact-demo", ["--resume"], env),
    error => error.stdout.includes(links.convex) && error.stderr.includes("exact-demo --resume"));
  assert.equal((await config()).appId, undefined);
  assert.equal(created, false);
  assert.deepEqual(calls, [
    "/api/users/current", "/api/connections/github/status", "/api/connections/github/connect",
    "/api/users/current", "/api/connections/github/status", "/api/connections/convex/status", "/api/connections/convex/connect",
  ]);

  connected.convex = true;
  const checking = new Promise(resolve => { holdGitHubStatus = resolve; });
  const interrupted = scaffold("exact-demo", ["--resume"], env);
  const interruptedResult = assert.rejects(interrupted,
    error => error.code === 130 && error.stderr.includes("exact-demo --resume"));
  await checking;
  interrupted.child.kill("SIGINT");
  await interruptedResult;
  holdGitHubStatus = undefined;
  assert.equal((await config()).appId, undefined);

  await assert.rejects(scaffold("exact-demo", ["--resume"], env), /exact-demo --resume/);
  assert.equal((await config()).appId, undefined);
  failCreate = false;
  const result = await scaffold("exact-demo", ["--resume"], env);
  assert.match(result.stdout, /App ID saved in disposabl.json/);
  assert.equal((await config()).appId, appId);
  assert.equal((await config()).apiOrigin, convexSiteUrl);
  assert.equal(created, true);
  const callsBeforeRejectedOrigin = calls.length;
  await assert.rejects(scaffold("exact-demo", ["--resume"], {
    ...env, DISPOSABL_API_ORIGIN: "",
  }), /Set DISPOSABL_API_ORIGIN/);
  assert.equal(calls.length, callsBeforeRejectedOrigin);
  assert.deepEqual((await config()).platforms, selected.platforms);
  assert.deepEqual((await config()).features, selected.features);
  const mobile = execFileSync("bun", ["--print", 'JSON.stringify((await import("./packages/disposabl-kit/server/platform.ts")).platform.mobile)'], {
    cwd: directory, encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(mobile).sort(), ["android", "ios"]);
  assert.equal(execFileSync("git", ["remote", "get-url", "origin"], { cwd: directory, encoding: "utf8" }).trim(), repositoryUrl);
  for (const file of ["packages/backend/.env.local", "apps/apps/.env.local"]) {
    await assert.rejects(access(join(directory, file)), { code: "ENOENT" });
  }

  const pinned = file => execFileSync("git", ["show", starterRef + ":" + file], {
    cwd: packageDir, encoding: "utf8",
  });
  const generatedSchema = await read("packages/backend/convex/schema.ts");
  assert.deepEqual([...generatedSchema.matchAll(/^\s*(\w+): defineTable\(/gm)].map(match => match[1]), ["users"]);
  assert.doesNotMatch(await read("apps/apps/app.contract"), /counter|convex-count|convex-increment/);
  assert.doesNotMatch(await read("apps/apps/app.ts"), /counter:/);
  assert.equal(await read("packages/bun.lock"), pinned("packages/bun.lock"));

  const app = JSON.parse(await read("apps/apps/app.json"));
  assert.equal(app.name, "exact-demo");
  assert.match(app.host.android.id, /^dev\.disposabl\.app\.a[a-z0-9]+$/);
  assert.equal(app.app.id, app.host.android.id);
  for (const source of ["apps/apps/auth.ts", "packages/disposabl-kit/server/authSettings.ts"]) {
    assert.ok((await read(source)).includes(app.app.id + ":/oauth/google"));
  }

  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  const sshOrigin = "git@github.com:Example/exact-demo.git";
  git("remote", "set-url", "origin", sshOrigin);
  const edited = { ...await config(), platforms: ["api"], features: ["authentication"] };
  await writeFile(join(directory, "disposabl.json"), JSON.stringify(edited));
  await scaffold("exact-demo", ["--resume"], env);
  assert.deepEqual(await config(), edited);
  assert.equal(git("config", "--get", "remote.origin.url"), sshOrigin);
  assert.equal((await config()).appId, appId);
  const deploy = parseDocument(await read(".github/workflows/deploy.yml"));
  assert.deepEqual(deploy.errors, []);
  assert.equal(deploy.hasIn(["jobs", "publish"]), false);
  assert.equal(deploy.getIn(["jobs", "deploy", "uses"]), "disposabl-dev/disposabl-exact/.github/workflows/deploy.yml@main");
  for (const file of [".github/workflows/refresh.yml", ".github/ci/boat.sh", ".github/ci/cache-build.sh", ".github/ci/android-key.sh"]) {
    await assert.rejects(access(join(directory, file)), { code: "ENOENT" });
  }
  await access(join(directory, "apps/apps/.gitignore"));

  const priorCalls = calls.length;
  await exec("npx", ["--yes", "--package", archive, "--", "create-disposabl-app", "offline-app", "--skip-setup"], {
    cwd: work, env: { ...process.env, ...env },
  });
  assert.equal(calls.length, priorCalls);
  const offline = JSON.parse(await readFile(join(work, "offline-app/disposabl.json"), "utf8"));
  assert.deepEqual(offline, { platforms: ["web", "cli"], features: ["authentication"] });
  await scaffold("headless-app", ["--skip-setup", "--platforms", "mcp,cli", "--features", ""], env);
  const headless = JSON.parse(await readFile(join(work, "headless-app/disposabl.json"), "utf8"));
  assert.deepEqual(headless, { platforms: ["mcp", "cli"], features: [] });
  await assert.rejects(scaffold("invalid-app", ["--skip-setup", "--features", "payments"], env), /payments requires authentication/);
  await assert.rejects(access(join(work, "invalid-app")), { code: "ENOENT" });
  await assert.rejects(scaffold("offline-app", ["--skip-setup"], env), /EEXIST/);
});
