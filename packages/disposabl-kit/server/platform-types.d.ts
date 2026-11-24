export type PlatformSelection = {
  web: boolean;
  mobile: readonly ("android" | "ios")[];
  macos: boolean;
  api: boolean;
  mcp: boolean;
  authentication: boolean;
  payments: boolean;
  frontend: boolean;
  native: boolean;
  credentials: boolean;
  consent: boolean;
};

export type PlatformModule = {
  platforms: readonly string[];
  features: readonly string[];
  read(value: unknown): PlatformSelection;
  featuresQuery: "app:features";
};

export declare const platform: PlatformModule;
