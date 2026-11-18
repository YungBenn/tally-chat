import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireOwner } from "./owner";

const toolValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.string(),
});

const toolServerView = v.object({
  _id: v.id("toolServers"),
  name: v.string(),
  url: v.string(),
  headerNames: v.array(v.string()),
  onForNewThreads: v.boolean(),
  // tokens: a rough size of the tool's definition, for the new-thread cost estimate.
  tools: v.array(v.object({ name: v.string(), description: v.optional(v.string()), tokens: v.number() })),
  alwaysAllowed: v.array(v.string()),
  lastTest: v.union(
    v.null(),
    v.object({ at: v.number(), ok: v.boolean(), error: v.optional(v.string()) }),
  ),
});

// The only shape a tool server leaves the server in: no header values, no input schemas.
const toView = (s: Doc<"toolServers">) => ({
  _id: s._id,
  name: s.name,
  url: s.url,
  headerNames: s.headerNames,
  onForNewThreads: s.onForNewThreads,
  tools: s.tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    tokens: Math.ceil(JSON.stringify({ name, description, inputSchema }).length / 4),
  })),
  alwaysAllowed: s.alwaysAllowed,
  lastTest: s.lastTest ?? null,
});

async function ownedServer(ctx: QueryCtx, ownerId: Id<"users">, id: Id<"toolServers">) {
  const server = await ctx.db.get("toolServers", id);
  if (!server || server.ownerId !== ownerId) throw new ConvexError("Tool server not found");
  return server;
}

export const list = query({
  args: {},
  returns: v.array(toolServerView),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db
      .query("toolServers")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(100);
    return rows.map(toView);
  },
});

export const setOnForNewThreads = mutation({
  args: { serverId: v.id("toolServers"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { serverId, on }) => {
    const server = await ownedServer(ctx, await requireOwner(ctx), serverId);
    await ctx.db.patch("toolServers", server._id, { onForNewThreads: on });
    return null;
  },
});

// "Always allow" changes no request bytes, so it can change at any time.
export const setAlwaysAllowed = mutation({
  args: { serverId: v.id("toolServers"), tool: v.string(), allowed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { serverId, tool, allowed }) => {
    const server = await ownedServer(ctx, await requireOwner(ctx), serverId);
    if (!server.tools.some((t) => t.name === tool)) throw new ConvexError("The server has no such tool");
    const rest = server.alwaysAllowed.filter((t) => t !== tool);
    await ctx.db.patch("toolServers", server._id, { alwaysAllowed: allowed ? [...rest, tool] : rest });
    return null;
  },
});

export const remove = mutation({
  args: { serverId: v.id("toolServers") },
  returns: v.null(),
  handler: async (ctx, { serverId }) => {
    const server = await ownedServer(ctx, await requireOwner(ctx), serverId);
    await ctx.db.delete("toolServers", server._id);
    return null;
  },
});

// Internal: what the actions need, including the encrypted headers.
export const getOwned = internalQuery({
  args: { ownerId: v.id("users"), serverId: v.id("toolServers") },
  returns: v.object({
    name: v.string(),
    url: v.string(),
    headersEncrypted: v.optional(v.string()),
  }),
  handler: async (ctx, { ownerId, serverId }) => {
    const { name, url, headersEncrypted } = await ownedServer(ctx, ownerId, serverId);
    return { name, url, headersEncrypted };
  },
});

// A name's slug prefixes its tools in a thread; it is unique among the owner's servers.
export const insert = internalMutation({
  args: {
    ownerId: v.id("users"),
    name: v.string(),
    url: v.string(),
    headersEncrypted: v.optional(v.string()),
    headerNames: v.array(v.string()),
    tools: v.array(toolValidator),
  },
  returns: v.id("toolServers"),
  handler: async (ctx, { ownerId, ...fields }) => {
    const taken = new Set(
      (
        await ctx.db
          .query("toolServers")
          .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
          .take(100)
      ).map((s) => s.slug),
    );
    const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "server";
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}_${i}`;
    return ctx.db.insert("toolServers", {
      ownerId,
      slug,
      onForNewThreads: false,
      alwaysAllowed: [],
      lastTest: { at: Date.now(), ok: true },
      ...fields,
    });
  },
});

export const update = internalMutation({
  args: {
    serverId: v.id("toolServers"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    headersEncrypted: v.optional(v.string()),
    headerNames: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, { serverId, ...fields }) => {
    await ctx.db.patch("toolServers", serverId, fields);
    return null;
  },
});

// Stores the result of a test or refresh. A failed one keeps the last good tool list.
export const saveTest = internalMutation({
  args: {
    serverId: v.id("toolServers"),
    tools: v.optional(v.array(toolValidator)),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { serverId, tools, error }) => {
    const server = await ctx.db.get("toolServers", serverId);
    if (!server) return null;
    await ctx.db.patch("toolServers", serverId, {
      ...(tools
        ? {
            tools,
            // A tool the server dropped can't stay allowed.
            alwaysAllowed: server.alwaysAllowed.filter((n) => tools.some((t) => t.name === n)),
          }
        : {}),
      lastTest: { at: Date.now(), ok: !error, error },
    });
    return null;
  },
});
