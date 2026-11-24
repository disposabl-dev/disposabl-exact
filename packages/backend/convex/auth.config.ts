import { convexAuthProvider } from "@convex-dev/auth/server";
import type { AuthConfig } from "convex/server";
import { project } from "@disposabl-kit/server/project-config";

export default { providers: project.authentication ? [convexAuthProvider()] : [] } satisfies AuthConfig;
