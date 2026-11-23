import type { Id } from "../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import type { ToolStatus } from "./toolParts";

// A tool tally.chat provides itself (ADR 0005). Its `name` is what the provider sees; tool server
// tool names always contain `__`, so a built-in name without one can't collide with them.
export type BuiltinTool = {
  name: string;
  approval: "never" | "always";
  // What a thread freezes for it, or null when the owner has nothing for it: then it isn't
  // offered, so new threads leave it out and a pick of it is refused.
  definition: (
    ctx: QueryCtx,
    ownerId: Id<"users">,
  ) => Promise<{ description: string; inputSchema: string } | null>;
  // Runs a call inside the tool loop; the text is capped and stored like any tool result.
  run: (
    ctx: ActionCtx,
    call: { ownerId: Id<"users">; input: string },
  ) => Promise<{ text: string; status: ToolStatus }>;
};

// In tool set order: built-in tools come before every server's tools.
export const builtinTools: BuiltinTool[] = [];

export const findBuiltin = (name: string) => builtinTools.find((b) => b.name === name);
