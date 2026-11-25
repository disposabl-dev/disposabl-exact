import { convexAuthProvider } from "@convex-dev/auth/server";
import type { AuthConfig } from "convex/server";
import { appPlatform as platform } from "./app-platform";

export default { providers: platform.authentication ? [convexAuthProvider()] : [] } satisfies AuthConfig;
