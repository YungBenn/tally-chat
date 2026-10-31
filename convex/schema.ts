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
});
