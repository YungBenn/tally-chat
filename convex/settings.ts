import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOwner } from "./owner";

const settingsFor = (ctx: QueryCtx, ownerId: Id<"users">) =>
  ctx.db.query("settings").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId)).unique();

// Accepts "host" or "host:port" (IPv6 in brackets); no scheme, path or credentials.
function normalizeHost(input: string): string {
  const raw = input.trim().toLowerCase();
  let url: URL;
  try {
    url = new URL(`http://${raw}`);
  } catch {
    throw new ConvexError("Enter a host like 192.168.1.20 or ollama.lan:11434");
  }
  if (url.host !== raw || url.pathname !== "/" || !url.hostname) {
    throw new ConvexError("Enter a host like 192.168.1.20 or ollama.lan:11434");
  }
  return url.host;
}

export const get = query({
  args: {},
  returns: v.object({ allowlistedHosts: v.array(v.string()) }),
  handler: async (ctx) => {
    const settings = await settingsFor(ctx, await requireOwner(ctx));
    return { allowlistedHosts: settings?.allowlistedHosts ?? [] };
  },
});

async function setHosts(ctx: MutationCtx, update: (hosts: string[]) => string[]) {
  const ownerId = await requireOwner(ctx);
  const settings = await settingsFor(ctx, ownerId);
  const allowlistedHosts = update(settings?.allowlistedHosts ?? []);
  if (settings) await ctx.db.patch("settings", settings._id, { allowlistedHosts });
  else await ctx.db.insert("settings", { ownerId, allowlistedHosts });
}

export const addAllowedHost = mutation({
  args: { host: v.string() },
  returns: v.null(),
  handler: async (ctx, { host }) => {
    const normalized = normalizeHost(host);
    await setHosts(ctx, (hosts) => (hosts.includes(normalized) ? hosts : [...hosts, normalized]));
    return null;
  },
});

export const removeAllowedHost = mutation({
  args: { host: v.string() },
  returns: v.null(),
  handler: async (ctx, { host }) => {
    await setHosts(ctx, (hosts) => hosts.filter((h) => h !== host));
    return null;
  },
});

export const allowlist = internalQuery({
  args: { ownerId: v.id("users") },
  returns: v.array(v.string()),
  handler: async (ctx, { ownerId }) => (await settingsFor(ctx, ownerId))?.allowlistedHosts ?? [],
});
