import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { builtinTools } from "./builtinTools";

// A thread's tool set (spec phase 10): the exact definitions its first send froze. `name` is what
// the provider sees (the server's slug plus the tool's name); `tool` is the server's own name.
// A built-in tool (ADR 0005) has no server: `builtin` says which it is, and is also its name.
export const frozenToolValidator = v.union(
  v.object({
    serverId: v.id("toolServers"),
    tool: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    inputSchema: v.string(), // JSON text, as the server sent it
  }),
  v.object({
    builtin: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    inputSchema: v.string(),
    skills: v.optional(v.array(v.string())), // read_skill: the catalog's names, so runs don't parse text
  }),
);
export type FrozenTool = Infer<typeof frozenToolValidator>;

export const toolDefinitionValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.string(),
});
// What a request carries for a tool: no ids, just the definition.
export type ToolDefinition = Pick<FrozenTool, "name" | "description" | "inputSchema">;
export const toDefinition = ({ name, description, inputSchema }: FrozenTool): ToolDefinition => ({
  name,
  description,
  inputSchema,
});

export const toolPickValidator = v.union(
  v.object({ serverId: v.id("toolServers"), tool: v.string() }),
  // skills: read_skill's catalog, by name; absent = every skill on for new threads.
  v.object({ builtin: v.string(), skills: v.optional(v.array(v.string())) }),
);
export type BuiltinPick = { builtin: string; skills?: string[] };
export type ToolPick = { serverId: Id<"toolServers">; tool: string } | BuiltinPick;
export const toPick = (t: FrozenTool): ToolPick =>
  "builtin" in t
    ? { builtin: t.builtin, ...(t.skills && { skills: t.skills }) }
    : { serverId: t.serverId, tool: t.tool };

// Whether a provider's model can call tools. Anthropic models all can unless marked otherwise;
// OpenAI-compatible models only when the owner said so (like vision, which they don't report).
export const supportsTools = (
  provider: Pick<Doc<"providers">, "apiStyle" | "models"> | null,
  modelId: string,
) => {
  const model = provider?.models.find((m) => m.id === modelId);
  return provider?.apiStyle === "anthropic" ? model?.tools !== false : model?.tools === true;
};

// Provider tool names are 1-64 characters of letters, digits, _ and -.
const providerSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

// Freezes picks into the definitions a thread will send. Built-in tools come first, those the
// owner has nothing for left out. Then server tools: names are the server's slug and the tool's
// name, unique within the set; order follows the servers, then each server's own order.
export async function freezeTools(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  servers: Doc<"toolServers">[],
  picks: ToolPick[],
): Promise<FrozenTool[]> {
  const wanted = new Set(picks.map((p) => ("builtin" in p ? p.builtin : `${p.serverId}\0${p.tool}`)));
  const taken = new Set<string>();
  const frozen: FrozenTool[] = [];
  for (const builtin of builtinTools) {
    const pick = picks.find((p): p is BuiltinPick => "builtin" in p && p.builtin === builtin.name);
    if (!pick) continue;
    const definition = await builtin.definition(ctx, ownerId, pick);
    if (definition) frozen.push({ builtin: builtin.name, name: builtin.name, ...definition });
  }
  for (const server of servers)
    for (const tool of server.tools) {
      if (!wanted.has(`${server._id}\0${tool.name}`)) continue;
      const base = providerSafe(`${server.slug}__${tool.name}`).slice(0, 64);
      let name = base;
      for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 60)}_${i}`;
      taken.add(name);
      frozen.push({
        serverId: server._id,
        tool: tool.name,
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
  return frozen;
}
