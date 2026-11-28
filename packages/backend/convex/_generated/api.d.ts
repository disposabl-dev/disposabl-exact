/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_index from "../agent/index.js";
import type * as agent_internal from "../agent/internal.js";
import type * as agent_validators from "../agent/validators.js";
import type * as app from "../app.js";
import type * as apps_actions_convex from "../apps/actions/convex.js";
import type * as apps_actions_create from "../apps/actions/create.js";
import type * as apps_actions_github from "../apps/actions/github.js";
import type * as apps_actions_provider from "../apps/actions/provider.js";
import type * as apps_actions_signing from "../apps/actions/signing.js";
import type * as apps_index from "../apps/index.js";
import type * as apps_internal from "../apps/internal.js";
import type * as apps_validators from "../apps/validators.js";
import type * as auth from "../auth.js";
import type * as billing_index from "../billing/index.js";
import type * as http from "../http.js";
import type * as lib_requireUserId from "../lib/requireUserId.js";
import type * as mcp from "../mcp.js";
import type * as previews_index from "../previews/index.js";
import type * as previews_internal from "../previews/internal.js";
import type * as previews_validators from "../previews/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/index": typeof agent_index;
  "agent/internal": typeof agent_internal;
  "agent/validators": typeof agent_validators;
  app: typeof app;
  "apps/actions/convex": typeof apps_actions_convex;
  "apps/actions/create": typeof apps_actions_create;
  "apps/actions/github": typeof apps_actions_github;
  "apps/actions/provider": typeof apps_actions_provider;
  "apps/actions/signing": typeof apps_actions_signing;
  "apps/index": typeof apps_index;
  "apps/internal": typeof apps_internal;
  "apps/validators": typeof apps_validators;
  auth: typeof auth;
  "billing/index": typeof billing_index;
  http: typeof http;
  "lib/requireUserId": typeof lib_requireUserId;
  mcp: typeof mcp;
  "previews/index": typeof previews_index;
  "previews/internal": typeof previews_internal;
  "previews/validators": typeof previews_validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authPassword: import("@convex-dev/auth/components/password/_generated/component.js").ComponentApi<"authPassword">;
  authUsername: import("@convex-dev/auth/components/username/_generated/component.js").ComponentApi<"authUsername">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  mcp: import("@convex-dev/mcp/_generated/component.js").ComponentApi<"mcp">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
