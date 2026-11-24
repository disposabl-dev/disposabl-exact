import config from "../../disposabl.json" with { type: "json" };
import { platform } from "../disposabl-kit/server/platforms";

export const appPlatform = platform.read(config);

if (import.meta.main && process.argv.includes("--mobile")) console.log(JSON.stringify(appPlatform.mobile));
