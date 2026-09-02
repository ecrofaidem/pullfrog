/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actionVersion from "../actionVersion.js";
import type * as auth from "../auth.js";
import type * as dispatch from "../dispatch.js";
import type * as handlers_cliSecrets from "../handlers/cliSecrets.js";
import type * as handlers_installationToken from "../handlers/installationToken.js";
import type * as handlers_runContext from "../handlers/runContext.js";
import type * as handlers_runtimeSecret from "../handlers/runtimeSecret.js";
import type * as handlers_webhook from "../handlers/webhook.js";
import type * as handlers_workflowRun from "../handlers/workflowRun.js";
import type * as http from "../http.js";
import type * as lib_base64 from "../lib/base64.js";
import type * as lib_codexOAuth from "../lib/codexOAuth.js";
import type * as lib_codexRefresh from "../lib/codexRefresh.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_envelope from "../lib/envelope.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_jwt from "../lib/jwt.js";
import type * as lib_oauthShared from "../lib/oauthShared.js";
import type * as lib_oidc from "../lib/oidc.js";
import type * as lib_runToken from "../lib/runToken.js";
import type * as repos from "../repos.js";
import type * as runs from "../runs.js";
import type * as secrets from "../secrets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actionVersion: typeof actionVersion;
  auth: typeof auth;
  dispatch: typeof dispatch;
  "handlers/cliSecrets": typeof handlers_cliSecrets;
  "handlers/installationToken": typeof handlers_installationToken;
  "handlers/runContext": typeof handlers_runContext;
  "handlers/runtimeSecret": typeof handlers_runtimeSecret;
  "handlers/webhook": typeof handlers_webhook;
  "handlers/workflowRun": typeof handlers_workflowRun;
  http: typeof http;
  "lib/base64": typeof lib_base64;
  "lib/codexOAuth": typeof lib_codexOAuth;
  "lib/codexRefresh": typeof lib_codexRefresh;
  "lib/crypto": typeof lib_crypto;
  "lib/envelope": typeof lib_envelope;
  "lib/github": typeof lib_github;
  "lib/http": typeof lib_http;
  "lib/jwt": typeof lib_jwt;
  "lib/oauthShared": typeof lib_oauthShared;
  "lib/oidc": typeof lib_oidc;
  "lib/runToken": typeof lib_runToken;
  repos: typeof repos;
  runs: typeof runs;
  secrets: typeof secrets;
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
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
