import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import * as prompts from "@clack/prompts";

const exec = promisify(execFile);

class PromptCancelled extends Error {}

function answer(value) {
  if (prompts.isCancel(value)) throw new PromptCancelled("Cancelled.");
  return value;
}

const labels = {
  web: "Web",
  android: "Android",
  ios: "iOS",
  macos: "macOS",
  api: "API",
  mcp: "MCP",
  cli: "CLI",
  "typescript-sdk": "TypeScript SDK",
  authentication: "Authentication",
  payments: "Payments",
};

export function createTerminal() {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  return {
    interactive,
    intro(resume) {
      if (interactive) prompts.intro(resume ? "Resume Exact setup" : "Create a Disposabl app with Exact");
    },
    async name(validate) {
      return answer(await prompts.text({
        message: "App name",
        placeholder: "my-app",
        validate: value => validate((value ?? "").trim()),
      })).trim();
    },
    async select(key, choices, defaults) {
      return answer(await prompts.multiselect({
        message: `Choose ${key}`,
        options: choices.map(value => ({ value, label: labels[value] ?? value })),
        initialValues: defaults,
        required: false,
      }));
    },
    async install(directory, config) {
      const progress = interactive ? prompts.spinner() : null;
      if (interactive) {
        const names = ids => ids.map(id => labels[id] ?? id).join(", ") || "None";
        prompts.note([
          `App         ${basename(directory)}`,
          `Platforms   ${names(config.platforms)}`,
          `Features    ${names(config.features)}`,
        ].join("\n"), "Project setup");
      }
      progress?.start("Installing project dependencies");
      try {
        await exec("bun", ["install", "--frozen-lockfile"], { cwd: directory });
        progress?.stop("Project dependencies installed");
      } catch (error) {
        progress?.stop("Dependency installation failed");
        throw error;
      }
    },
    complete(directory) {
      const message = `Created ${directory}\n\ncd ${basename(directory)}\nbun run dev`;
      if (interactive) prompts.outro(message);
      else console.log(message);
    },
    fail(error) {
      if (interactive) prompts.cancel(error.message);
      else console.error(error.message);
      return error instanceof PromptCancelled ? 130 : 1;
    },
  };
}
