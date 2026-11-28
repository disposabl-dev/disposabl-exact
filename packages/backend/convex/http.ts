import { createHttp } from "@disposabl-kit/server/http.ts";
import { authorizeSandbox, registerSandboxRoutes } from "./agent/http";
import { registerProviderConnections } from "./connections/http";

const http = createHttp(undefined, authorizeSandbox);
registerSandboxRoutes(http);
registerProviderConnections(http);
export default http;
