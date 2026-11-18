"use node";

import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { listMcpTools } from "./lib/mcp";
import type { GuardOptions } from "./lib/urlGuard";
import { decryptSecret, encryptSecret } from "./lib/vault";
import { requireOwner } from "./owner";

const systemResolve = async (host: string) =>
  (await lookup(host, { all: true })).map((a) => a.address);

async function guardFor(ctx: ActionCtx, ownerId: Id<"users">): Promise<GuardOptions> {
  const allowlist: string[] = await ctx.runQuery(internal.settings.allowlist, { ownerId });
  return { allowlist, resolve: systemResolve };
}

const headersValidator = v.array(v.object({ name: v.string(), value: v.string() }));

function cleanUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.href;
  } catch {
    throw new ConvexError("URL is not a valid http(s) URL");
  }
}

// Header names are HTTP tokens; empty rows are dropped, a repeated name keeps its last value.
function cleanHeaders(rows: { name: string; value: string }[]) {
  const headers: Record<string, string> = {};
  for (const { name, value } of rows) {
    const n = name.trim();
    if (!n && !value.trim()) continue;
    if (!/^[A-Za-z0-9-]+$/.test(n)) throw new ConvexError(`"${n}" is not a valid header name`);
    headers[n] = value.trim();
  }
  return headers;
}

const sealHeaders = async (headers: Record<string, string>) =>
  Object.keys(headers).length
    ? { headersEncrypted: await encryptSecret(JSON.stringify(headers)), headerNames: Object.keys(headers) }
    : { headersEncrypted: undefined, headerNames: [] };

// Connects first, so a server that doesn't answer is never saved.
export const add = action({
  args: { name: v.string(), url: v.string(), headers: v.optional(headersValidator) },
  returns: v.id("toolServers"),
  handler: async (ctx, args): Promise<Id<"toolServers">> => {
    const ownerId = await requireOwner(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Name is required");
    const url = cleanUrl(args.url);
    const headers = cleanHeaders(args.headers ?? []);
    const tools = await listMcpTools(url, headers, await guardFor(ctx, ownerId));
    return ctx.runMutation(internal.toolServers.insert, {
      ownerId,
      name,
      url,
      tools,
      ...(await sealHeaders(headers)),
    });
  },
});

// Changes name, URL or headers. `headers` replaces the stored set when given; omitted keeps it.
export const edit = action({
  args: {
    serverId: v.id("toolServers"),
    name: v.string(),
    url: v.string(),
    headers: v.optional(headersValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    const server = await ctx.runQuery(internal.toolServers.getOwned, { ownerId, serverId: args.serverId });
    const name = args.name.trim();
    if (!name) throw new ConvexError("Name is required");
    const url = cleanUrl(args.url);
    const headers = args.headers
      ? cleanHeaders(args.headers)
      : server.headersEncrypted
        ? (JSON.parse(await decryptSecret(server.headersEncrypted)) as Record<string, string>)
        : {};
    const tools = await listMcpTools(url, headers, await guardFor(ctx, ownerId));
    await ctx.runMutation(internal.toolServers.update, {
      serverId: args.serverId,
      name,
      url,
      ...(args.headers ? await sealHeaders(headers) : {}),
    });
    await ctx.runMutation(internal.toolServers.saveTest, { serverId: args.serverId, tools });
    return null;
  },
});

// Test and refresh are one call: list the tools again and store them, or store why it failed.
export const refresh = action({
  args: { serverId: v.id("toolServers") },
  returns: v.null(),
  handler: async (ctx, { serverId }) => {
    const ownerId = await requireOwner(ctx);
    const server = await ctx.runQuery(internal.toolServers.getOwned, { ownerId, serverId });
    try {
      const headers = server.headersEncrypted
        ? (JSON.parse(await decryptSecret(server.headersEncrypted)) as Record<string, string>)
        : {};
      const tools = await listMcpTools(server.url, headers, await guardFor(ctx, ownerId));
      await ctx.runMutation(internal.toolServers.saveTest, { serverId, tools });
    } catch (err) {
      await ctx.runMutation(internal.toolServers.saveTest, {
        serverId,
        error: err instanceof ConvexError ? String(err.data) : "Could not connect to the server",
      });
    }
    return null;
  },
});
