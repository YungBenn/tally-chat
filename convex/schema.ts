import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

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
  }).index("by_threadId", ["threadId"]),
  settings: defineTable({
    ownerId: v.id("users"),
    allowlistedHosts: v.array(v.string()), // private hosts the URL guard lets through, e.g. "192.168.1.20:11434"
  }).index("by_ownerId", ["ownerId"]),
});
