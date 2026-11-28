import { createHttp } from "@disposabl-kit/server/http.ts";
import { authorizeSandbox, registerSandboxRoutes } from "./agent/http";
import { registerProviderConnections } from "./connections/http";
import { reportDeployment } from "./deployments/http";

const http = createHttp(undefined, authorizeSandbox);
registerSandboxRoutes(http);
registerProviderConnections(http);
http.route({ path: "/github/deployments", method: "POST", handler: reportDeployment });
export default http;
