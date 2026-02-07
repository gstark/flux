/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as epics from "../epics.js";
import type * as issues from "../issues.js";
import type * as labels from "../labels.js";
import type * as llmCosts from "../llmCosts.js";
import type * as nuke from "../nuke.js";
import type * as orchestratorConfig from "../orchestratorConfig.js";
import type * as projects from "../projects.js";
import type * as seeds from "../seeds.js";
import type * as sessionEvents from "../sessionEvents.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  epics: typeof epics;
  issues: typeof issues;
  labels: typeof labels;
  llmCosts: typeof llmCosts;
  nuke: typeof nuke;
  orchestratorConfig: typeof orchestratorConfig;
  projects: typeof projects;
  seeds: typeof seeds;
  sessionEvents: typeof sessionEvents;
  sessions: typeof sessions;
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
