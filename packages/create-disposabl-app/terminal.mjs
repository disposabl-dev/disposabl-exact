import * as prompts from "@clack/prompts";

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
    complete(directory) {
      const message = `Created ${directory}\nSee README.md for local development and deployment.`;
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
