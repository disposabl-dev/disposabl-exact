import type { setupGoogle } from "@convex-dev/auth/methods/google/server";
import { componentsGeneric, createFunctionHandle } from "convex/server";
import { project } from "@disposabl-kit/server/project-config";
import { env } from "./_generated/server";

export const GOOGLE_WEB_RETURN = "/.exact/auth/callback";
export const GOOGLE_NATIVE_RETURN = "/api/auth/native-return";
export const GOOGLE_NATIVE_CALLBACK = "dev.disposabl.exact:/oauth/google";
export const siteOrigin = () => new URL(env.CONVEX_SITE_URL).origin;
export const googleEnabled = () => project.authentication && project.frontend && Boolean(
  env.AUTH_GOOGLE_CLIENT_ID?.trim() && env.AUTH_GOOGLE_CLIENT_SECRET?.trim(),
);

// The generated component list depends on the deployment's Google configuration.
export const googleComponent = (componentsGeneric() as unknown as {
  authGoogle: Parameters<typeof setupGoogle>[1]["component"];
}).authGoogle;

export async function googleAvailable() {
  if (!googleEnabled()) return false;
  try {
    await createFunctionHandle(googleComponent.provider.getUserIdByAccount);
    return true;
  } catch {
    // Both keys may have been set after the last deploy. Convex must first
    // mount the optional component before the app offers sign-in.
    return false;
  }
}
