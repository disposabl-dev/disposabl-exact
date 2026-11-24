import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploymentPlan, releaseMatrices } from "../../../scripts/deploy-plan.mjs";
import { features, platforms, projectConfig } from "@disposabl-kit/server/project-config";

process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
const { createHttp } = await import("@disposabl-kit/server/http");

function combinations(values: string[]) {
  return Array.from({ length: 2 ** values.length }, (_, mask) =>
    values.filter((_, index) => mask & (1 << index)));
}

describe("disposabl.json", () => {
  for (const selected of combinations(platforms)) {
    for (const enabled of combinations(features)) {
      test(`platforms=${selected.join(",") || "none"} features=${enabled.join(",") || "none"}`, () => {
        const authentication = enabled.includes("authentication");
        const payments = enabled.includes("payments");
        if (payments && !authentication) {
          expect(() => projectConfig({ platforms: selected, features: enabled })).toThrow("payments requires authentication");
          return;
        }
        const config = projectConfig({ platforms: selected, features: enabled });
        const web = selected.includes("web");
        const mobile = ["android", "ios"].filter(platform => selected.includes(platform));
        const macos = selected.includes("macos");
        const api = selected.includes("api");
        const mcp = selected.includes("mcp");
        const consent = web && authentication && mcp;
        const credentials = web && authentication && (api || mcp);

        for (const isPublic of [false, true]) {
          const expectedJobs = (web ? ["web"] : []).concat(mobile);
          const publicAndroid = isPublic && mobile.includes("android");
          const plan = deploymentPlan(config, isPublic);
          expect(plan.frontend).toBe(web || mobile.length > 0 || macos);
          expect(plan.macos).toBe(macos);
          expect(plan.web).toBe(web);
          expect(plan.mobile).toBe(mobile.length > 0);
          expect(plan["mobile-platforms"]).toEqual(mobile);
          expect(plan.matrix.map(entry => entry.platform)).toEqual(
            expectedJobs.filter(platform => platform !== "android" || !publicAndroid),
          );
          expect(plan.public_android).toEqual(publicAndroid ? [{ platform: "android", channel: "base-1" }] : []);
          const ota = mobile.map(platform => ({ platform, channel: "base-2" }));
          expect(releaseMatrices(ota, isPublic)).toEqual({
            matrix: ota.filter(entry => entry.platform !== "android" || !publicAndroid),
            public_android: publicAndroid ? [{ platform: "android", channel: "base-2" }] : [],
          });
        }

        const router = createHttp(config);
        const has = (path: string, method: "GET" | "POST") =>
          router.exactRoutes.get(path)?.has(method) ?? false;
        const notFound = router.lookup("/api/disposabl/missing", "GET")?.[0];
        const open = (path: string, method: "GET" | "POST") => {
          const route = router.lookup(path, method);
          return Boolean(route && route[0] !== notFound &&
            route[0] !== router.lookup("/api/disposabl/missing", "POST")?.[0]);
        };
        expect(open("/", "GET")).toBe(web);
        expect(open("/pricing", "GET")).toBe(web && payments);
        expect(has("/api/auth/web", "POST")).toBe(authentication && web);
        expect(has("/api/auth/native", "POST")).toBe(authentication && (mobile.length > 0 || macos));
        expect(has("/api/billing/web", "POST")).toBe(payments && web);
        expect(has("/api/billing/native", "POST")).toBe(payments && (mobile.length > 0 || macos));
        expect(open("/openapi.json", "GET")).toBe(api);
        expect(has("/api/counter/current", "GET")).toBe(api);
        expect(open("/mcp", "POST")).toBe(mcp);
        expect(open("/.well-known/oauth-authorization-server", "GET")).toBe(consent);
        expect(has("/api/mcp/consent", "POST")).toBe(consent);
        expect(has("/api/platform/credentials", "POST")).toBe(credentials);
        expect(open("/consent", "GET")).toBe(consent);
        expect(open("/api-keys", "GET")).toBe(credentials);
        if (consent) expect(router.lookup("/consent", "GET")?.[0]).toBe(router.lookup("/", "GET")?.[0]);
        if (credentials) expect(router.lookup("/api-keys", "GET")?.[0]).toBe(router.lookup("/", "GET")?.[0]);
      });
    }
  }

  test("rejects missing, duplicate, and unknown selections", () => {
    for (const input of [
      null,
      {},
      { platforms: "web", features: [] },
      { platforms: ["windows"], features: [] },
      { platforms: ["web", "web"], features: [] },
      { platforms: [], features: ["billing"] },
      { platforms: [], features: ["authentication", "authentication"] },
    ]) expect(() => projectConfig(input)).toThrow("disposabl.json");
  });
});

test("dev stops before starting Convex when payments needs authentication", async () => {
  const checkout = await mkdtemp(join(tmpdir(), "exact-config-"));
  try {
    for (const file of [
      "packages/backend/package.json",
      "packages/disposabl-kit/server/dev.ts",
      "packages/disposabl-kit/server/generate-platforms.ts",
      "packages/disposabl-kit/server/project-config.mjs",
    ]) {
      await Bun.write(join(checkout, file), Bun.file(new URL(`../../../${file}`, import.meta.url)));
    }
    await Bun.write(join(checkout, "disposabl.json"), JSON.stringify({
      platforms: ["web"], features: ["payments"],
    }));
    const dev = Bun.spawnSync([process.execPath, "run", "dev"], {
      cwd: join(checkout, "packages/backend"),
    });
    expect(dev.exitCode).toBe(1);
    expect(dev.stderr.toString()).toContain('Add "authentication" to "features" or remove "payments".');
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
});
