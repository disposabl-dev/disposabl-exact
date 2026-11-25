import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploymentPlan, releaseMatrices } from "../../../scripts/deploy-plan.mjs";
import { platform } from "@disposabl-kit/server/platforms.ts";
const { features, platforms, read: readPlatform } = platform;

process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
const { createHttp } = await import("@disposabl-kit/server/http.ts");

function combinations(values: readonly string[]) {
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
          expect(() => readPlatform({ platforms: selected, features: enabled })).toThrow("payments requires authentication");
          return;
        }
        const config = readPlatform({ platforms: selected, features: enabled });
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
        const native = mobile.length > 0 || macos;
        const missing = router.lookup("/api/missing", "GET")?.[0];
        const routes = [
          ["/", web],
          ["/pricing", web && payments],
          ["/api/auth/web", web && authentication, "POST"],
          ["/api/auth/native", native && authentication, "POST"],
          ["/api/platform/web", web && authentication, "POST"],
          ["/api/platform/native", native && authentication, "POST"],
          ["/api/billing/web", web && payments, "POST"],
          ["/api/billing/native", native && payments, "POST"],
          ["/openapi.json", api],
          ["/api/counter/current", api],
          ["/mcp", mcp, "POST"],
          ["/.well-known/oauth-authorization-server", consent],
          ["/api/mcp/consent", consent, "POST"],
          ["/api/platform/credentials", credentials, "POST"],
          ["/consent", consent],
          ["/api-keys", credentials],
        ] as const;
        for (const [path, enabled, method = "GET"] of routes) {
          const handler = router.lookup(path, method)?.[0];
          expect(Boolean(handler && handler !== missing), `${method} ${path}`).toBe(enabled);
        }
        if (!authentication || !(web || native)) {
          const callback = router.lookup("/oauth/google/callback", "GET")?.[0];
          expect(callback).toBe(missing);
        }
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
    ]) expect(() => readPlatform(input)).toThrow("disposabl.json");
  });
});

test("dev stops before starting Convex when payments needs authentication", async () => {
  const appDir = await mkdtemp(join(tmpdir(), "exact-app-config-"));
  try {
    for (const file of [
      "packages/backend/package.json",
      "packages/disposabl-kit/server/platforms-build.ts",
      "packages/disposabl-kit/server/platform.ts",
    ]) {
      await Bun.write(join(appDir, file), Bun.file(new URL(`../../../${file}`, import.meta.url)));
    }
    await Bun.write(join(appDir, "disposabl.json"), JSON.stringify({
      platforms: ["web"], features: ["payments"],
    }));
    const dev = Bun.spawnSync([process.execPath, "run", "dev"], {
      cwd: join(appDir, "packages/backend"),
    });
    expect(dev.exitCode).toBe(1);
    expect(dev.stderr.toString()).toContain('Add "authentication" to "features" or remove "payments".');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});
