import http from "@disposabl-kit/server/http.ts";
import { registerProviderConnections } from "./connections/http";

registerProviderConnections(http);
export default http;
