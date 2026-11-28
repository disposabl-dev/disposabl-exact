import config from "../../../disposabl.json" with { type: "json" };
import { features, platforms, readProjectConfig } from "./platform-config.mjs";

function readPlatform(value: unknown) {
  const { selected, enabled } = readProjectConfig(value);
  const authentication = enabled.has("authentication");
  const payments = enabled.has("payments");
  const web = selected.has("web");
  const mobile: readonly ("android" | "ios")[] = (["android", "ios"] as const).filter(name => selected.has(name));
  const macos = selected.has("macos");
  const packages = [
    ...(selected.has("cli") ? ["cli"] : []),
    ...(selected.has("typescript-sdk") ? ["sdk"] : []),
  ];
  const api = selected.has("api") || packages.length > 0;
  const mcp = selected.has("mcp");
  const native = mobile.length > 0 || macos;
  return {
    web, mobile, macos, api, mcp, authentication, payments, packages,
    frontend: web || native,
    native,
    credentials: web && authentication && (api || mcp),
    consent: web && authentication && (api || mcp),
    oauth: authentication && (api || (web && mcp)),
  };
}

export type PlatformSelection = ReturnType<typeof readPlatform>;

export const platform = {
  ...readPlatform(config),
  platforms,
  features,
  read: readPlatform,
} as const;

export function releaseMatrices<Entry extends { platform: string }>(entries: readonly Entry[], publicRepo: boolean) {
  const publicAndroid = (entry: Entry) => publicRepo && entry.platform === "android";
  return {
    matrix: entries.filter(entry => !publicAndroid(entry)),
    public_android: entries.filter(publicAndroid),
  };
}

export function deploymentOutputs(config: PlatformSelection, publicRepo: boolean) {
  const builds = [
    ...(config.web ? [{ platform: "web" }] : []),
    ...config.mobile.map(platform => ({ platform, channel: "base-1" })),
  ];
  return {
    web: config.web,
    frontend: config.frontend,
    mobile: config.mobile.length > 0,
    "mobile-platforms": config.mobile,
    macos: config.macos,
    ...releaseMatrices(builds, publicRepo),
  };
}
