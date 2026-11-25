import type { CreateClientConfig } from "./generated/client.gen.js";
import {
  createClient as createFetchClient,
  type Config,
} from "./generated/client/index.js";
import { jsonQueryParameters } from "./query-parameters.generated.js";

function exactConfig<T extends Config>(config: T): T {
  return {
    redirect: "error",
    ...config,
    requestValidator: async (request) => {
      await config.requestValidator?.(request);
      const options = request as {
        url: string;
        querySerializer: (query: Record<string, unknown>) => string;
      };
      const fields = jsonQueryParameters[options.url];
      if (fields) {
        options.querySerializer = (query) =>
          new URLSearchParams(
            Object.entries(query)
              .filter(([, value]) => value !== undefined)
              .map(([name, value]) => [
                name,
                fields.includes(name) ? JSON.stringify(value) : String(value),
              ]),
          ).toString();
      }
    },
  };
}

export const createClientConfig: CreateClientConfig = (config) =>
  exactConfig({ ...config, baseUrl: "" });
export const createClient = (config: Config) =>
  createFetchClient(exactConfig(config));
