import { convexAuthProvider } from "@convex-dev/auth/server";
import type { AuthConfig } from "convex/server";
import { platform } from "./platform";

export default { providers: platform.authentication ? [convexAuthProvider()] : [] } satisfies AuthConfig;
