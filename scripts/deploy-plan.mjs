import { appendFileSync } from "node:fs";
import { project, releaseMatrices } from "./project-config.mjs";

export function deploymentPlan(config, publicRepo) {
  const first = [
    ...(config.web ? [{ platform: "web" }] : []),
    ...config.mobile.map(platform => ({ platform, channel: "base-1" })),
  ];
  return {
    web: config.web,
    frontend: config.frontend,
    backend: config.backend,
    mobile: config.mobile.length > 0,
    "mobile-platforms": config.mobile,
    macos: config.macos,
    ...releaseMatrices(first, publicRepo),
  };
}

if (process.argv[1] === import.meta.filename) {
  const outputs = deploymentPlan(project, process.env.PUBLIC_REPO === "true");
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}\n`).join(""));
}
