import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
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
    models: v.array(v.object({ id: v.string(), displayName: v.string(), hidden: v.boolean() })),
    free: v.optional(v.boolean()), // owner says it costs nothing (local models): cost is recorded as $0
    // Learned from usage fields the provider actually returns, never assumed.
    capabilities: v.optional(v.object({ caching: v.boolean(), reasoning: v.boolean() })),
  }).index("by_ownerId", ["ownerId"]),
  threads: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    providerId: v.id("providers"),
    modelId: v.string(),
    systemPromptVersion: v.number(),
    activeLeafId: v.optional(v.id("messages")),
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
    status: v.union(v.literal("streaming"), v.literal("done"), v.literal("stopped"), v.literal("error")),
    streamId: v.optional(v.string()),
    stopRequested: v.optional(v.boolean()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    usage: v.optional(usageValidator), // as reported by the provider
    costMicroUsd: v.optional(v.number()), // absent with usage present = model has no price
  }).index("by_threadId", ["threadId"]),
  // Per owner, UTC day and dimension: sums kept in the mutation that finalizes a reply
  // (design doc S10, 8.2). Survives thread deletes so daily spend stays accurate.
  dailyUsage: defineTable({
    ownerId: v.id("users"),
    day: v.string(), // YYYY-MM-DD, UTC
    dimension: v.union(v.literal("model"), v.literal("provider"), v.literal("thread")),
    key: v.string(),
    calls: v.number(),
    unpricedCalls: v.number(),
    costMicroUsd: v.number(),
    ...usageValidator.fields,
  }).index("by_owner_day_dimension_key", ["ownerId", "day", "dimension", "key"]),
  settings: defineTable({
    ownerId: v.id("users"),
    allowlistedHosts: v.array(v.string()), // private hosts the URL guard lets through, e.g. "192.168.1.20:11434"
  }).index("by_ownerId", ["ownerId"]),
});
