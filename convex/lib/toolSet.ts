import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

// A thread's tool set (spec phase 10): the exact definitions its first send froze. `name` is what
// the provider sees (the server's slug plus the tool's name); `tool` is the server's own name.
export const frozenToolValidator = v.object({
  serverId: v.id("toolServers"),
  tool: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.string(), // JSON text, as the server sent it
});
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

export const toolPickValidator = v.object({ serverId: v.id("toolServers"), tool: v.string() });
export type ToolPick = { serverId: Id<"toolServers">; tool: string };

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

// Freezes picks into the definitions a thread will send. Names are the server's slug and the
// tool's name, unique within the set; order follows the servers, then each server's own order.
export function freezeTools(servers: Doc<"toolServers">[], picks: ToolPick[]): FrozenTool[] {
  const wanted = new Set(picks.map((p) => `${p.serverId}\0${p.tool}`));
  const taken = new Set<string>();
  const frozen: FrozenTool[] = [];
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
