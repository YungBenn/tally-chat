import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { cacheTtlValidator } from "./lib/cacheStatus";
import { outputModeValidator } from "./lib/outputModes";
import { usageValidator } from "./lib/usage";

// Convention: every table the owner creates has `ownerId: v.id("users")`,
// set via `requireOwner` in ./owner.ts, so multi-user later is a feature
// rather than a migration.
export default defineSchema({
  ...authTables,
  providers: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    apiStyle: v.union(v.literal("anthropic"), v.literal("openai-compatible")),
    baseUrl: v.string(),
    apiKeyEncrypted: v.string(), // never leaves the server; see lib/vault.ts
    detected: v.string(), // which provider the key belongs to, e.g. "Anthropic · org 1a2b3c4d"
    keyCheckedAt: v.number(),
    models: v.array(
      v.object({
        id: v.string(),
        displayName: v.string(),
        hidden: v.boolean(),
      }),
    ),
    free: v.optional(v.boolean()), // owner says it costs nothing (local models): cost is recorded as $0
    // Learned from usage fields the provider actually returns, never assumed.
    capabilities: v.optional(
      v.object({ caching: v.boolean(), reasoning: v.boolean() }),
    ),
  }).index("by_ownerId", ["ownerId"]),
  threads: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    providerId: v.id("providers"),
    modelId: v.string(),
    systemPromptVersion: v.number(),
    activeLeafId: v.optional(v.id("messages")),
    titleRequested: v.optional(v.boolean()), // the side-job title runs once per thread
    lastActiveAt: v.optional(v.number()), // owner focused on or typing in the thread (keepalive presence)
    // Start time of the last request that read or wrote this thread's prompt cache, and the
    // lifetime it asked for: the cache is warm until cacheTouchedAt + cacheTtl.
    cacheTouchedAt: v.optional(v.number()),
    cacheTtl: v.optional(cacheTtlValidator),
    keepaliveJobId: v.optional(v.id("_scheduled_functions")), // the thread's one pending keepalive, if any
  }).index("by_ownerId", ["ownerId"]),
  // Append-only tree (ADR 0001). The only update a message ever gets is
  // streaming -> final status (plus the stop flag before that).
  messages: defineTable({
    ownerId: v.id("users"),
    threadId: v.id("threads"),
    parentId: v.optional(v.id("messages")),
    ancestorIds: v.array(v.id("messages")), // root..parent, so a branch is one read
    role: v.union(v.literal("user"), v.literal("assistant")),
    pinned: v.boolean(),
    content: v.string(), // final text; while streaming the text lives in streamId
    status: v.union(
      v.literal("streaming"),
      v.literal("done"),
      v.literal("stopped"),
      v.literal("error"),
    ),
    streamId: v.optional(v.string()),
    stopRequested: v.optional(v.boolean()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    usage: v.optional(usageValidator), // as reported by the provider
    costMicroUsd: v.optional(v.number()), // absent with usage present = model has no price
    outputMode: v.optional(outputModeValidator), // replies: the length limit asked for; absent = normal
    truncated: v.optional(v.boolean()), // replies that stopped at that limit
  })
    .index("by_thread_parent", ["threadId", "parentId"])
    .index("by_status", ["status"]),
  // A summary standing in for every message up to coversUpToId on any branch containing it
  // (ADR 0001). Stored outside the tree so condensing never rewrites messages.
  checkpoints: defineTable({
    ownerId: v.id("users"),
    threadId: v.id("threads"),
    coversUpToId: v.id("messages"),
    summary: v.string(),
    tokens: v.number(),
  }).index("by_threadId", ["threadId"]),
  // Metered model calls that are not part of the conversation (design doc S6 side jobs).
  sideJobs: defineTable({
    ownerId: v.id("users"),
    threadId: v.id("threads"),
    kind: v.union(v.literal("title"), v.literal("keepalive")),
    providerId: v.id("providers"),
    model: v.string(),
    usage: usageValidator,
    costMicroUsd: v.optional(v.number()),
  }).index("by_threadId", ["threadId"]),
  // Per owner, UTC day and dimension: sums kept in the mutation that finalizes a reply
  // (design doc S10, 8.2). Survives thread deletes so daily spend stays accurate.
  dailyUsage: defineTable({
    ownerId: v.id("users"),
    day: v.string(), // YYYY-MM-DD in the owner's time zone at the time of the call
    // "upkeep" rolls up keepalives only, keyed by thread (cache upkeep per thread and per day).
    dimension: v.union(
      v.literal("model"),
      v.literal("provider"),
      v.literal("thread"),
      v.literal("upkeep"),
    ),
    key: v.string(),
    calls: v.number(),
    unpricedCalls: v.number(),
    costMicroUsd: v.number(),
    // Read discount minus write premiums, summed (lib/usage cacheSavingsMicroUsd). Absent on rows
    // from before phase 3 until the backfill fills it; read as 0.
    savedMicroUsd: v.optional(v.number()),
    ...usageValidator.fields,
  })
    .index("by_owner_day_dimension_key", ["ownerId", "day", "dimension", "key"])
    .index("by_owner_dimension_key_day", [
      "ownerId",
      "dimension",
      "key",
      "day",
    ]),
  settings: defineTable({
    ownerId: v.id("users"),
    allowlistedHosts: v.array(v.string()), // private hosts the URL guard lets through, e.g. "192.168.1.20:11434"
    // Model for work the user didn't ask for directly (titles now, condensing later).
    // Unset: the cheapest priced model of the thread's own provider.
    sideJobModel: v.optional(
      v.object({ providerId: v.id("providers"), modelId: v.string() }),
    ),
    timeZone: v.optional(v.string()), // IANA name; daily rollups use the owner's day, UTC until set
    keepaliveEnabled: v.optional(v.boolean()), // absent = on; off = 1-hour cache lifetime instead
    cacheBreakConfirmMicroUsd: v.optional(v.number()), // edits costing more than this ask first; absent = $0.10
    dailyBudgetMicroUsd: v.optional(v.number()), // soft daily budget; absent = none
    budgetOverrideDay: v.optional(v.string()), // the owner's day (YYYY-MM-DD) the budget is overridden for
  }).index("by_ownerId", ["ownerId"]),
});
