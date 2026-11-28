import { createHttp } from "@disposabl-kit/server/http.ts";
import { registerProviderConnections } from "./connections/http";

const http = createHttp();
registerProviderConnections(http);
export default http;
