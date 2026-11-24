import { appendFileSync } from "node:fs";
import { appPlatform as platform } from "../packages/backend/app-platform.ts";

export function releaseMatrices(entries, publicRepo) {
  const publicAndroid = entry => publicRepo && entry.platform === "android";
  return {
    matrix: entries.filter(entry => !publicAndroid(entry)),
    public_android: entries.filter(publicAndroid),
  };
}

export function deploymentPlan(config, publicRepo) {
  const first = [
    ...(config.web ? [{ platform: "web" }] : []),
    ...config.mobile.map(platform => ({ platform, channel: "base-1" })),
  ];
  return {
    web: config.web,
    frontend: config.frontend,
    mobile: config.mobile.length > 0,
    "mobile-platforms": config.mobile,
    macos: config.macos,
    ...releaseMatrices(first, publicRepo),
  };
}

if (process.argv[1] === import.meta.filename) {
  const outputs = deploymentPlan(platform, process.env.PUBLIC_REPO === "true");
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}\n`).join(""));
}
