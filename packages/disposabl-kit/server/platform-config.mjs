export const platforms = Object.freeze(["web", "android", "ios", "macos", "api", "mcp", "cli", "typescript-sdk"]);
export const features = Object.freeze(["authentication", "payments"]);

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} key
 */
function selection(value, allowed, key) {
  if (!Array.isArray(value) || value.some(item => !allowed.includes(item))) {
    throw new Error(`disposabl.json ${key} must be an array of ${allowed.join(", ")}`);
  }
  const selected = new Set(/** @type {string[]} */ (value));
  if (selected.size !== value.length) {
    throw new Error(`disposabl.json ${key} contains duplicate entries`);
  }
  return selected;
}

/** @param {unknown} value */
export function readProjectConfig(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("disposabl.json must be an object");
  }
  const app = /** @type {{platforms?: unknown, features?: unknown}} */ (value);
  const selected = selection(app.platforms, platforms, "platforms");
  const enabled = selection(app.features, features, "features");
  if (enabled.has("payments") && !enabled.has("authentication")) {
    throw new Error('In disposabl.json, payments requires authentication. Add "authentication" to "features" or remove "payments".');
  }
  return { selected, enabled };
}
