/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_actions_boat from "../agent/actions/boat.js";
import type * as agent_actions_credentials from "../agent/actions/credentials.js";
import type * as agent_actions_run from "../agent/actions/run.js";
import type * as agent_actions_workspace from "../agent/actions/workspace.js";
import type * as agent_http from "../agent/http.js";
import type * as agent_index from "../agent/index.js";
import type * as agent_internal from "../agent/internal.js";
import type * as agent_validators from "../agent/validators.js";
import type * as app from "../app.js";
import type * as apps_actions_convex from "../apps/actions/convex.js";
import type * as apps_actions_create from "../apps/actions/create.js";
import type * as apps_actions_github from "../apps/actions/github.js";
import type * as apps_actions_provider from "../apps/actions/provider.js";
import type * as apps_actions_signing from "../apps/actions/signing.js";
import type * as apps_http from "../apps/http.js";
import type * as apps_index from "../apps/index.js";
import type * as apps_internal from "../apps/internal.js";
import type * as apps_references from "../apps/references.js";
import type * as apps_validators from "../apps/validators.js";
import type * as auth from "../auth.js";
import type * as billing_index from "../billing/index.js";
import type * as connections_actions_crypto from "../connections/actions/crypto.js";
import type * as connections_actions_oauth from "../connections/actions/oauth.js";
import type * as connections_convex_index from "../connections/convex/index.js";
import type * as connections_convex_internal from "../connections/convex/internal.js";
import type * as connections_github_index from "../connections/github/index.js";
import type * as connections_github_internal from "../connections/github/internal.js";
import type * as connections_http from "../connections/http.js";
import type * as connections_index from "../connections/index.js";
import type * as connections_internal from "../connections/internal.js";
import type * as connections_validators from "../connections/validators.js";
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
  "agent/actions/boat": typeof agent_actions_boat;
  "agent/actions/credentials": typeof agent_actions_credentials;
  "agent/actions/run": typeof agent_actions_run;
  "agent/actions/workspace": typeof agent_actions_workspace;
  "agent/http": typeof agent_http;
  "agent/index": typeof agent_index;
  "agent/internal": typeof agent_internal;
  "agent/validators": typeof agent_validators;
  app: typeof app;
  "apps/actions/convex": typeof apps_actions_convex;
  "apps/actions/create": typeof apps_actions_create;
  "apps/actions/github": typeof apps_actions_github;
  "apps/actions/provider": typeof apps_actions_provider;
  "apps/actions/signing": typeof apps_actions_signing;
  "apps/http": typeof apps_http;
  "apps/index": typeof apps_index;
  "apps/internal": typeof apps_internal;
  "apps/references": typeof apps_references;
  "apps/validators": typeof apps_validators;
  auth: typeof auth;
  "billing/index": typeof billing_index;
  "connections/actions/crypto": typeof connections_actions_crypto;
  "connections/actions/oauth": typeof connections_actions_oauth;
  "connections/convex/index": typeof connections_convex_index;
  "connections/convex/internal": typeof connections_convex_internal;
  "connections/github/index": typeof connections_github_index;
  "connections/github/internal": typeof connections_github_internal;
  "connections/http": typeof connections_http;
  "connections/index": typeof connections_index;
  "connections/internal": typeof connections_internal;
  "connections/validators": typeof connections_validators;
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
