import type { PlatformModule } from "./platform-types.d.ts";

const platforms = ["web", "android", "ios", "macos", "api", "mcp"];
const features = ["authentication", "payments"];

function selection(value: unknown, allowed: readonly string[], key: string) {
  if (!Array.isArray(value) || value.some(item => !allowed.includes(item))) {
    throw new Error(`disposabl.json ${key} must be an array of ${allowed.join(", ")}`);
  }
  const selected = new Set<string>(value);
  if (selected.size !== value.length) {
    throw new Error(`disposabl.json ${key} contains duplicate entries`);
  }
  return selected;
}

function readPlatform(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("disposabl.json must be an object");
  }
  const app = value as Record<string, unknown>;
  const selected = selection(app.platforms, platforms, "platforms");
  const enabled = selection(app.features, features, "features");
  const authentication = enabled.has("authentication");
  const payments = enabled.has("payments");
  if (payments && !authentication) {
    throw new Error('In disposabl.json, payments requires authentication. Add "authentication" to "features" or remove "payments".');
  }
  const web = selected.has("web");
  const mobile = (["android", "ios"] as const).filter(platform => selected.has(platform));
  const macos = selected.has("macos");
  const api = selected.has("api");
  const mcp = selected.has("mcp");
  return {
    web, mobile, macos, api, mcp, authentication, payments,
    frontend: web || mobile.length > 0 || macos,
    native: mobile.length > 0 || macos,
    credentials: web && authentication && (api || mcp),
    consent: web && authentication && mcp,
  };
}

export const platform: PlatformModule = { platforms, features, read: readPlatform, featuresQuery: "app:features" };
