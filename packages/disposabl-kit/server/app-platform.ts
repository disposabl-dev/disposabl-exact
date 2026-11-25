import config from "../../../disposabl.json" with { type: "json" };
import { platform } from "./platform";

export const appPlatform = platform.read(config);
