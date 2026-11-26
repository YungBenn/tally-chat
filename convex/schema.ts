import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { cacheTtlValidator } from "./lib/cacheStatus";
import { effortValidator } from "./lib/effort";
import { imageValidator } from "./lib/images";
import { outputModeValidator } from "./lib/outputModes";
import { usageValidator } from "./lib/usage";
import { searchResultValidator } from "./lib/webSearch";
import { documentRefValidator } from "./lib/documents";
import { frozenToolValidator } from "./lib/toolSet";
import { partValidator } from "./lib/toolParts";

export const importSourceValidator = v.union(
  v.literal("chatgpt"),
  v.literal("claude"),
);

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
        vision: v.optional(v.boolean()), // accepts images; absent = no
        tools: v.optional(v.boolean()), // can call tools (spec phase 10); see lib/toolSet supportsTools
        favorite: v.optional(v.boolean()), // starred in the model picker; absent = no
      }),
    ),
    free: v.optional(v.boolean()), // owner says it costs nothing (local models): cost is recorded as $0
    // Learned from usage fields the provider actually returns, never assumed.
    capabilities: v.optional(
      v.object({ caching: v.boolean(), reasoning: v.boolean() }),
    ),
  }).index("by_ownerId", ["ownerId"]),
  // A remote MCP server (spec phase 10): its tools are offered to threads. Header values are
  // encrypted as one blob and never leave the server; headerNames is all the client sees.
  toolServers: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    slug: v.string(), // prefixes this server's tool names in a thread; fixed once set
    url: v.string(),
    headersEncrypted: v.optional(v.string()),
    headerNames: v.array(v.string()),
    onForNewThreads: v.boolean(),
    // The server's tool list as of the last test or refresh. inputSchema is JSON text: JSON
    // Schema keys such as $schema can't be stored as document fields.
    tools: v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
        inputSchema: v.string(),
      }),
    ),
    alwaysAllowed: v.array(v.string()), // tool names that run without asking; changes no request bytes
    lastTest: v.optional(
      v.object({ at: v.number(), ok: v.boolean(), error: v.optional(v.string()) }),
    ),
  }).index("by_ownerId", ["ownerId"]),
  threads: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    providerId: v.id("providers"),
    modelId: v.string(),
    systemPromptVersion: v.number(),
    instructions: v.optional(v.string()), // the owner's custom instructions when the thread began
    // The tool definitions the first send froze (spec phase 10); every request sends these bytes.
    // Absent or empty = no tools.
    toolSet: v.optional(v.array(frozenToolValidator)),
    activeLeafId: v.optional(v.id("messages")),
    titleRequested: v.optional(v.boolean()), // the side-job title runs once per thread
    renamed: v.optional(v.boolean()), // the owner named it; a side-job title never replaces that
    pinnedAt: v.optional(v.number()), // pinned threads list first, most recently pinned on top
    // Moved to threadStates (spec phase 12); kept only until migrations:moveThreadState empties them.
    lastActiveAt: v.optional(v.number()),
    cacheTouchedAt: v.optional(v.number()),
    cacheTtl: v.optional(cacheTtlValidator),
    keepaliveJobId: v.optional(v.id("_scheduled_functions")),
    effort: v.optional(effortValidator), // Anthropic-style threads: sent on every request; absent = low
    condenseJobId: v.optional(v.id("_scheduled_functions")), // the thread's one pending or running condense
    condenseFailure: v.optional(v.string()), // why the last condense wrote no checkpoint; cleared by the next one
    // When the conversation started: creation time, or the original date of an imported one.
    // Absent only on threads from before phase 7 until migrations:backfillThreadStartedAt runs.
    startedAt: v.optional(v.number()),
    // A conversation brought in from another app's export (spec phase 7); re-imports skip it.
    importedFrom: v.optional(
      v.object({ source: importSourceValidator, externalId: v.string() }),
    ),
  })
    .index("by_ownerId_and_startedAt", ["ownerId", "startedAt"])
    .index("by_ownerId_and_pinnedAt", ["ownerId", "pinnedAt"])
    .index("by_ownerId_and_importedFrom", [
      "ownerId",
      "importedFrom.source",
      "importedFrom.externalId",
    ])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["ownerId"],
    }),
  // A thread's presence and cache bookkeeping (spec phase 12). It changes every minute while the
  // owner is in the thread, so it lives apart from the thread row: writes here don't re-run the
  // thread page, the inspector or the thread list. At most one row per thread, made on first write.
  threadStates: defineTable({
    threadId: v.id("threads"),
    lastActiveAt: v.optional(v.number()), // owner focused on or typing in the thread (keepalive presence)
    // Start time of the last request that read or wrote this thread's prompt cache, and the
    // lifetime it asked for: the cache is warm until cacheTouchedAt + cacheTtl.
    cacheTouchedAt: v.optional(v.number()),
    cacheTtl: v.optional(cacheTtlValidator),
    keepaliveJobId: v.optional(v.id("_scheduled_functions")), // the thread's one pending keepalive, if any
  }).index("by_threadId", ["threadId"]),
  // Append-only tree (ADR 0001). The only updates a message ever gets are
  // streaming -> final status (plus the stop flag before that) and its pin,
  // which can change only until a checkpoint covers it.
  messages: defineTable({
    ownerId: v.id("users"),
    threadId: v.id("threads"),
    parentId: v.optional(v.id("messages")),
    // Moved to messageAncestors (spec phase 12); kept only until migrations:moveMessageAncestors
    // empties it.
    ancestorIds: v.optional(v.array(v.id("messages"))),
    role: v.union(v.literal("user"), v.literal("assistant")),
    pinned: v.boolean(),
    content: v.string(), // final text; while a step streams its text lives in its streams row
    status: v.union(
      v.literal("streaming"),
      v.literal("waiting"), // a tool step waits for the owner's approval; no action runs (spec phase 10)
      v.literal("done"),
      v.literal("stopped"),
      v.literal("error"),
    ),
    streamId: v.optional(v.string()), // legacy (persistent-text-streaming, ADR 0004): never written
    stopRequested: v.optional(v.boolean()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
    providerId: v.optional(v.id("providers")),
    usage: v.optional(usageValidator), // as reported by the provider; a reply's is the sum of its steps
    costMicroUsd: v.optional(v.number()), // absent with usage present = model has no price
    // Replies: usage and cost of each step (one model request) in order. Absent on replies from
    // before phase 10, which were one step.
    steps: v.optional(
      v.array(
        v.object({ usage: usageValidator, costMicroUsd: v.optional(v.number()) }),
      ),
    ),
    outputMode: v.optional(outputModeValidator), // replies: the length limit asked for; absent = normal
    truncated: v.optional(v.boolean()), // replies that stopped at that limit
    // Replies that called a tool (spec phase 10): the ordered text, thinking, tool calls and results
    // of every step. content is then the text parts joined. Absent on replies without tools.
    parts: v.optional(v.array(partValidator)),
    pendingApproval: v.optional(
      v.object({ step: v.number(), callIds: v.array(v.string()), requestedAt: v.number() }),
    ),
    approvalExpired: v.optional(v.boolean()), // stopped because nobody approved for 30 minutes
    hitStepLimit: v.optional(v.boolean()), // truncated because the reply ran out of steps, not tokens
    stepStartedAt: v.optional(v.number()), // when the current step began; the stuck-reply sweep counts from it
    effort: v.optional(effortValidator), // user: a per-message change made here; replies: the level they ran at
    images: v.optional(v.array(imageValidator)), // user messages: images sent with it, fixed at creation
    search: v.optional(v.boolean()), // user messages: searched the web before the reply (see searches)
    documents: v.optional(v.array(documentRefValidator)), // user messages: documents sent with it
    brevity: v.optional(v.string()), // user messages: instruction sent after the text (quick mode), frozen with it
  })
    .index("by_thread_parent", ["threadId", "parentId"])
    .index("by_status", ["status"])
    // Full-text message search (spec phase 7). Content is written once, at finalize, so an
    // entry never changes after that; a streaming reply's content is empty until then.
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["ownerId"],
    }),
  // A message's ancestors, root..parent, so a branch is one read (ADR 0001). One row per message,
  // written with it and never changed; apart from the message so reading a branch reads each path
  // once, not once per message (lib/ancestors).
  messageAncestors: defineTable({
    messageId: v.id("messages"),
    ancestorIds: v.array(v.id("messages")),
  }).index("by_messageId", ["messageId"]),
  // The text so far of a reply's streaming step (lib/textStream, ADR 0004): one row while the step
  // streams, deleted when it ends.
  streams: defineTable({
    messageId: v.id("messages"),
    text: v.string(),
  }).index("by_messageId", ["messageId"]),
  // A document's extracted text (lib/documents). threadId is set when a message first sends it;
  // until then it is a composer attachment, swept after a day.
  documents: defineTable({
    ownerId: v.id("users"),
    threadId: v.optional(v.id("threads")),
    name: v.string(),
    text: v.string(),
    tokens: v.number(),
    fromThreadId: v.optional(v.id("threads")), // a mentioned thread's copy (documents.fromThread)
  }).index("by_threadId", ["threadId"]),
  // The web search run for a user message (lib/webSearch), written once before its first reply.
  searches: defineTable({
    ownerId: v.id("users"),
    messageId: v.id("messages"),
    query: v.string(),
    results: v.array(searchResultValidator),
    error: v.optional(v.string()),
    costMicroUsd: v.optional(v.number()), // what Exa reported; absent when it reported none
  }).index("by_messageId", ["messageId"]),
  // A summary standing in for every message up to coversUpToId on any branch containing it
  // (ADR 0001). Stored outside the tree so condensing never rewrites messages.
  checkpoints: defineTable({
    ownerId: v.id("users"),
    threadId: v.id("threads"),
    coversUpToId: v.id("messages"),
    summary: v.string(),
    tokens: v.number(),
    promptVersion: v.optional(v.number()), // SUMMARY_PROMPTS version; absent means 1
  }).index("by_threadId", ["threadId"]),
  // Metered model calls that are not part of the conversation (design doc S6 side jobs).
  sideJobs: defineTable({
    ownerId: v.id("users"),
    threadId: v.id("threads"),
    kind: v.union(
      v.literal("title"),
      v.literal("keepalive"),
      v.literal("condense"),
    ),
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
  // An upload of another app's conversations.json, imported in the background (spec phase 7).
  imports: defineTable({
    ownerId: v.id("users"),
    fileName: v.string(),
    storageId: v.optional(v.id("_storage")), // deleted once the import finishes or fails
    source: v.optional(importSourceValidator), // detected from the file's shape
    providerId: v.id("providers"), // the model imported threads continue on
    modelId: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    total: v.optional(v.number()), // conversations in the file, once parsed
    imported: v.number(),
    skipped: v.number(), // already imported earlier
    error: v.optional(v.string()),
  }).index("by_ownerId", ["ownerId"]),
  settings: defineTable({
    ownerId: v.id("users"),
    customInstructions: v.optional(v.string()), // copied onto each new thread; absent = none
    searchKeyEncrypted: v.optional(v.string()), // the owner's Exa API key, vault-encrypted; absent = no web search
    searchUrl: v.optional(v.string()), // legacy: the old SearXNG URL, kept so saved settings validate; unused
    allowlistedHosts: v.array(v.string()), // private hosts the URL guard lets through, e.g. "192.168.1.20:11434"
    // Model for work the user didn't ask for directly (titles now, condensing later).
    // Unset: the cheapest priced model of the thread's own provider.
    sideJobModel: v.optional(
      v.object({ providerId: v.id("providers"), modelId: v.string() }),
    ),
    // What a new thread starts with; unset = the first listed model and DEFAULT_EFFORT.
    defaultModel: v.optional(
      v.object({ providerId: v.id("providers"), modelId: v.string() }),
    ),
    defaultEffort: v.optional(effortValidator),
    timeZone: v.optional(v.string()), // IANA name; daily rollups use the owner's day, UTC until set
    keepaliveEnabled: v.optional(v.boolean()), // absent = on; off = 1-hour cache lifetime instead
    cacheBreakConfirmMicroUsd: v.optional(v.number()), // edits costing more than this ask first; absent = $0.10
    dailyBudgetMicroUsd: v.optional(v.number()), // soft daily budget; absent = none
    budgetOverrideDay: v.optional(v.string()), // the owner's day (YYYY-MM-DD) the budget is overridden for
    // Condensing (spec phase 6); absent = the defaults in lib/condense.
    condenseEnabled: v.optional(v.boolean()),
    condenseAtTokens: v.optional(v.number()), // verbatim turns since the checkpoint that trigger a condense
    condenseKeepTurns: v.optional(v.number()), // recent turns always kept verbatim
    condenseMinThreadTokens: v.optional(v.number()), // threads smaller than this never condense
    condensePaybackTurns: v.optional(v.number()), // the cache veto holds condenses that pay back slower
  }).index("by_ownerId", ["ownerId"]),
});
