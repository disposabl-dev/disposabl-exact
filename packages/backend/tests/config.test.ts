import { expect, test } from "bun:test";
import { deploymentOutputs, platform } from "@disposabl-kit/server/platforms.ts";

test("payments requires authentication", () => {
  expect(() => platform.read({ platforms: ["web"], features: ["payments"] }))
    .toThrow('Add "authentication" to "features" or remove "payments".');
});

test("deploy only builds selected clients", () => {
  const entries = platform.read({ platforms: ["web", "android", "mcp"], features: [] });
  expect(deploymentOutputs(entries, true)).toEqual({
    web: true,
    frontend: true,
    mobile: true,
    "mobile-platforms": ["android"],
    macos: false,
    matrix: [{ platform: "web" }],
    public_android: [{ platform: "android", channel: "base-1" }],
  });

  const headless = platform.read({ platforms: ["mcp"], features: [] });
  expect(deploymentOutputs(headless, true)).toEqual({
    web: false,
    frontend: false,
    mobile: false,
    "mobile-platforms": [],
    macos: false,
    matrix: [],
    public_android: [],
  });
});
