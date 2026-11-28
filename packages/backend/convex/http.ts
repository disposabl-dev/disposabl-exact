import { createHttp } from "@disposabl-kit/server/http.ts";
import { authorizeSandbox, registerSandboxRoutes } from "./agent/http";
import { publish } from "./apps/http";
import { publishPath } from "./apps/validators";
import { registerProviderConnections } from "./connections/http";

const http = createHttp(undefined, authorizeSandbox);
registerSandboxRoutes(http);
registerProviderConnections(http);
http.route({ path: publishPath, method: "POST", handler: publish });
export default http;
