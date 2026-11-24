import config from "../disposabl.json" with { type: "json" };

export const platforms = ["web", "android", "ios", "macos", "api", "mcp"];
export const features = ["authentication", "payments"];

function selection(value, allowed, key) {
  if (!Array.isArray(value) || value.some(item => !allowed.includes(item))) {
    throw new Error(`disposabl.json ${key} must be an array of ${allowed.join(", ")}`);
  }
  const selected = new Set(value);
  if (selected.size !== value.length) {
    throw new Error(`disposabl.json ${key} contains duplicate entries`);
  }
  return selected;
}

export function projectConfig(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("disposabl.json must be an object");
  }
  const selected = selection(value.platforms, platforms, "platforms");
  const enabled = selection(value.features, features, "features");
  const authentication = enabled.has("authentication");
  const payments = enabled.has("payments");
  if (payments && !authentication) {
    throw new Error("disposabl.json payments requires authentication");
  }
  const web = selected.has("web");
  const mobile = ["android", "ios"].filter(platform => selected.has(platform));
  const macos = selected.has("macos");
  const api = selected.has("api");
  const mcp = selected.has("mcp");
  return {
    web, mobile, macos, api, mcp, authentication, payments,
    frontend: web || mobile.length > 0 || macos,
    backend: selected.size > 0,
    native: mobile.length > 0 || macos,
    credentials: web && authentication && (api || mcp),
    consent: web && authentication && mcp,
  };
}

export const project = projectConfig(config);

export function releaseMatrices(entries, publicRepo) {
  const publicAndroid = entry => publicRepo && entry.platform === "android";
  return {
    matrix: entries.filter(entry => !publicAndroid(entry)),
    public_android: entries.filter(publicAndroid),
  };
}
