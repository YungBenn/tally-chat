/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as chatActions from "../chatActions.js";
import type * as http from "../http.js";
import type * as lib_anthropic from "../lib/anthropic.js";
import type * as lib_context from "../lib/context.js";
import type * as lib_openaiCompatible from "../lib/openaiCompatible.js";
import type * as lib_rollups from "../lib/rollups.js";
import type * as lib_systemPrompts from "../lib/systemPrompts.js";
import type * as lib_textStream from "../lib/textStream.js";
import type * as lib_urlGuard from "../lib/urlGuard.js";
import type * as lib_usage from "../lib/usage.js";
import type * as lib_vault from "../lib/vault.js";
import type * as owner from "../owner.js";
import type * as providerActions from "../providerActions.js";
import type * as providers from "../providers.js";
import type * as settings from "../settings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  chatActions: typeof chatActions;
  http: typeof http;
  "lib/anthropic": typeof lib_anthropic;
  "lib/context": typeof lib_context;
  "lib/openaiCompatible": typeof lib_openaiCompatible;
  "lib/rollups": typeof lib_rollups;
  "lib/systemPrompts": typeof lib_systemPrompts;
  "lib/textStream": typeof lib_textStream;
  "lib/urlGuard": typeof lib_urlGuard;
  "lib/usage": typeof lib_usage;
  "lib/vault": typeof lib_vault;
  owner: typeof owner;
  providerActions: typeof providerActions;
  providers: typeof providers;
  settings: typeof settings;
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
  persistentTextStreaming: import("@convex-dev/persistent-text-streaming/_generated/component.js").ComponentApi<"persistentTextStreaming">;
};
