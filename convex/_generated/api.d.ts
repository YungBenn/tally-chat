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
import type * as condense from "../condense.js";
import type * as crons from "../crons.js";
import type * as documentActions from "../documentActions.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as importActions from "../importActions.js";
import type * as imports from "../imports.js";
import type * as inspector from "../inspector.js";
import type * as keepalive from "../keepalive.js";
import type * as lib_addSkill from "../lib/addSkill.js";
import type * as lib_ancestors from "../lib/ancestors.js";
import type * as lib_anthropic from "../lib/anthropic.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_builtinTools from "../lib/builtinTools.js";
import type * as lib_cacheStatus from "../lib/cacheStatus.js";
import type * as lib_condense from "../lib/condense.js";
import type * as lib_context from "../lib/context.js";
import type * as lib_documents from "../lib/documents.js";
import type * as lib_effort from "../lib/effort.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_images from "../lib/images.js";
import type * as lib_importParse from "../lib/importParse.js";
import type * as lib_mcp from "../lib/mcp.js";
import type * as lib_metering from "../lib/metering.js";
import type * as lib_openaiCompatible from "../lib/openaiCompatible.js";
import type * as lib_outputModes from "../lib/outputModes.js";
import type * as lib_readSkill from "../lib/readSkill.js";
import type * as lib_rollups from "../lib/rollups.js";
import type * as lib_search from "../lib/search.js";
import type * as lib_skills from "../lib/skills.js";
import type * as lib_systemPrompts from "../lib/systemPrompts.js";
import type * as lib_systemResolve from "../lib/systemResolve.js";
import type * as lib_textStream from "../lib/textStream.js";
import type * as lib_toolParts from "../lib/toolParts.js";
import type * as lib_toolResult from "../lib/toolResult.js";
import type * as lib_toolSet from "../lib/toolSet.js";
import type * as lib_urlGuard from "../lib/urlGuard.js";
import type * as lib_usage from "../lib/usage.js";
import type * as lib_vault from "../lib/vault.js";
import type * as lib_webSearch from "../lib/webSearch.js";
import type * as migrations from "../migrations.js";
import type * as owner from "../owner.js";
import type * as providerActions from "../providerActions.js";
import type * as providers from "../providers.js";
import type * as search from "../search.js";
import type * as settings from "../settings.js";
import type * as skillActions from "../skillActions.js";
import type * as skills from "../skills.js";
import type * as threadState from "../threadState.js";
import type * as toolServerActions from "../toolServerActions.js";
import type * as toolServers from "../toolServers.js";
import type * as usage from "../usage.js";
import type * as webSearch from "../webSearch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  chatActions: typeof chatActions;
  condense: typeof condense;
  crons: typeof crons;
  documentActions: typeof documentActions;
  documents: typeof documents;
  http: typeof http;
  importActions: typeof importActions;
  imports: typeof imports;
  inspector: typeof inspector;
  keepalive: typeof keepalive;
  "lib/addSkill": typeof lib_addSkill;
  "lib/ancestors": typeof lib_ancestors;
  "lib/anthropic": typeof lib_anthropic;
  "lib/budget": typeof lib_budget;
  "lib/builtinTools": typeof lib_builtinTools;
  "lib/cacheStatus": typeof lib_cacheStatus;
  "lib/condense": typeof lib_condense;
  "lib/context": typeof lib_context;
  "lib/documents": typeof lib_documents;
  "lib/effort": typeof lib_effort;
  "lib/github": typeof lib_github;
  "lib/images": typeof lib_images;
  "lib/importParse": typeof lib_importParse;
  "lib/mcp": typeof lib_mcp;
  "lib/metering": typeof lib_metering;
  "lib/openaiCompatible": typeof lib_openaiCompatible;
  "lib/outputModes": typeof lib_outputModes;
  "lib/readSkill": typeof lib_readSkill;
  "lib/rollups": typeof lib_rollups;
  "lib/search": typeof lib_search;
  "lib/skills": typeof lib_skills;
  "lib/systemPrompts": typeof lib_systemPrompts;
  "lib/systemResolve": typeof lib_systemResolve;
  "lib/textStream": typeof lib_textStream;
  "lib/toolParts": typeof lib_toolParts;
  "lib/toolResult": typeof lib_toolResult;
  "lib/toolSet": typeof lib_toolSet;
  "lib/urlGuard": typeof lib_urlGuard;
  "lib/usage": typeof lib_usage;
  "lib/vault": typeof lib_vault;
  "lib/webSearch": typeof lib_webSearch;
  migrations: typeof migrations;
  owner: typeof owner;
  providerActions: typeof providerActions;
  providers: typeof providers;
  search: typeof search;
  settings: typeof settings;
  skillActions: typeof skillActions;
  skills: typeof skills;
  threadState: typeof threadState;
  toolServerActions: typeof toolServerActions;
  toolServers: typeof toolServers;
  usage: typeof usage;
  webSearch: typeof webSearch;
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

export declare const components: {};
