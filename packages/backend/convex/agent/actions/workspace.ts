import { command, writeFile } from "./boat";

const workspace = "/home/user/disposabl-workspaces";
const runtime = "/dev/shm/disposabl";
const install = `set -eu
umask 077
install -d -m 700 ${runtime} "$HOME/.local/lib/disposabl" "$HOME/.local/bin" "${workspace}"
rm -f ${runtime}/github.json
install -m 600 /tmp/disposabl-session.json ${runtime}/session.json
rm -f /tmp/disposabl-session.json
install -m 700 /tmp/disposabl-workspace.mjs "$HOME/.local/lib/disposabl/workspace.mjs"
rm -f /tmp/disposabl-workspace.mjs
git config --global user.name "Disposabl Agent"
git config --global user.email disposabl-agent@users.noreply.github.com
git config --global credential.https://github.com.useHttpPath true
git config --global --replace-all credential.https://github.com.helper '!bun "$HOME/.local/lib/disposabl/workspace.mjs" git'
printf '%s\\n' '#!/bin/sh' 'exec bun "$HOME/.local/lib/disposabl/workspace.mjs" gh "$@"' > "$HOME/.local/bin/gh"
printf '%s\\n' '#!/bin/sh' 'exec bun "$HOME/.local/lib/disposabl/workspace.mjs" preview "$@"' > "$HOME/.local/bin/disposabl-preview"
chmod 700 "$HOME/.local/bin/gh" "$HOME/.local/bin/disposabl-preview"
`;

const helper = `import { readFileSync, writeFileSync } from "node:fs";
const [tool, ...args] = process.argv.slice(2);
const session = JSON.parse(readFileSync("${runtime}/session.json", "utf8"));
const githubCache = "${runtime}/github.json";
async function access(provider) {
  if (provider === "github") {
    try {
      const saved = JSON.parse(readFileSync(githubCache, "utf8"));
      if (Date.now() + 60_000 < saved.expiresAt) return saved;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const response = await fetch(session.origin + "/api/sandbox/" + provider, {
    method: "POST", headers: { Authorization: "Bearer " + session.token },
    redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Workspace " + provider + " access failed (" + response.status + "). Run a new Disposabl turn.");
  const result = await response.json();
  if (provider === "github") writeFileSync(githubCache, JSON.stringify(result), { mode: 0o600 });
  return result;
}
try {
  if (tool === "git") {
    if (args[0] === "get") {
      const fields = Object.fromEntries(readFileSync(0, "utf8").trim().split("\\n").filter(Boolean).map(line => {
        const equals = line.indexOf("=");
        return [line.slice(0, equals), line.slice(equals + 1)];
      }));
      if (fields.protocol === "https" && fields.host === "github.com" && fields.path) {
        const { repository, token } = await access("github");
        if (fields.path.replace(/\\.git$/, "").toLowerCase() === repository.toLowerCase()) {
          console.log("username=x-access-token\\npassword=" + token);
        }
      }
    }
  } else if (tool === "gh") {
    const { token } = await access("github");
    const path = (process.env.PATH ?? "").split(":").filter(entry => entry !== process.env.HOME + "/.local/bin").join(":");
    const binary = Bun.which("gh", { PATH: path });
    if (!binary) throw new Error("GitHub CLI is unavailable.");
    const gh = Bun.spawn([binary, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit",
      env: { ...process.env, GH_HOST: "github.com", GH_TOKEN: token } });
    process.exitCode = await gh.exited;
  } else if (tool === "preview") {
    const { deployKey, previewName } = await access("convex");
    const build = Bun.spawn(["bun", "run", "generate:platforms"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const result = await build.exited;
    if (result) process.exit(result);
    const deploy = Bun.spawn(["bunx", "convex", "deploy", "--preview-name", previewName], {
      stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
    });
    process.exitCode = await deploy.exited;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`;

export async function installWorkspace(
  sandboxId: string,
  session: { origin: string; token: string; expiresAt: number; turnId: string },
  threadId: string,
  appSlug?: string,
  repository?: string,
) {
  if (!/^[a-zA-Z0-9]+$/.test(threadId)) throw new Error("Malformed conversation identifier.");
  if (repository && !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error("Malformed GitHub repository.");

  await writeFile(sandboxId, "/tmp/disposabl-session.json", JSON.stringify(session));
  await writeFile(sandboxId, "/tmp/disposabl-workspace.mjs", helper);
  await command(sandboxId, install);
  if (appSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appSlug)) throw new Error("Malformed app slug.");
  const parent = `${workspace}/${threadId}`;
  const directory = repository && appSlug ? `${parent}/${appSlug}` : parent;
  const branch = "disposabl/" + threadId;
  if (repository) {
    const origin = `https://github.com/${repository}.git`;
    await command(sandboxId, `set -eu
      mkdir -p '${parent}'
      cd '${parent}'
      if [ ! -d '${directory}/.git' ] && [ ! -d '${directory}' ]; then
        GIT_TERMINAL_PROMPT=0 git clone '${origin}' '${directory}'
        git -C '${directory}' checkout '${branch}' 2>/dev/null || git -C '${directory}' checkout -b '${branch}'
      fi`, 60);
  } else {
    await command(sandboxId, `mkdir -p '${parent}'`);
  }
  return { directory, branch };
}

export function clearWorkspace(sandboxId: string, turnId: string) {
  if (!/^[a-zA-Z0-9]+$/.test(turnId)) throw new Error("Malformed turn identifier.");
  return command(sandboxId, `if grep -Fq '"turnId":"${turnId}"' ${runtime}/session.json 2>/dev/null; then
    rm -f ${runtime}/session.json ${runtime}/github.json
  fi
  if grep -Fq '"turnId":"${turnId}"' /tmp/disposabl-session.json 2>/dev/null; then
    rm -f /tmp/disposabl-session.json
  fi`);
}
