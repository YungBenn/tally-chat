"use client";

import { IconTool } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/fields";
import { Popover } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Pick = { serverId: Id<"toolServers">; tool: string };
const keyOf = (p: Pick) => `${p.serverId}|${p.tool}`;

/**
 * The tools a new thread will freeze at its first message (spec phase 10): every tool of the
 * servers that are on for new threads until the owner changes the picks. Offered only for a
 * tool-capable model, and only when a tool server exists.
 */
export function useToolPicker(capable: boolean) {
  const servers = useQuery(api.toolServers.list);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const all = (servers ?? []).flatMap((s) => s.tools.map((t) => ({ serverId: s._id, tool: t.name })));
  const defaults = new Set(
    (servers ?? []).filter((s) => s.onForNewThreads).flatMap((s) => s.tools.map((t) => keyOf({ serverId: s._id, tool: t.name }))),
  );
  const chosen = picked ?? defaults;
  return {
    available: capable && all.length > 0,
    servers: servers ?? [],
    chosen,
    // What the send carries: undefined when the model can't call tools, else the explicit picks.
    picks: capable ? all.filter((p) => chosen.has(keyOf(p))) : undefined,
    // Rough tokens of the chosen definitions: they go out with the first request.
    tokens: capable
      ? (servers ?? []).flatMap((s) => s.tools.filter((t) => chosen.has(keyOf({ serverId: s._id, tool: t.name })))).reduce((sum, t) => sum + t.tokens, 0)
      : 0,
    setChosen: setPicked,
  };
}

type Servers = ReturnType<typeof useToolPicker>["servers"];

/** Every tool server with its tools as checkboxes; a server's box toggles all of its tools. */
export function ToolChecklist({
  servers,
  chosen,
  onChange,
}: {
  servers: Servers;
  chosen: Set<string>;
  onChange: (chosen: Set<string>) => void;
}) {
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  };
  if (servers.length === 0)
    return (
      <p className="text-body-sm text-foreground-muted">
        No tool servers yet. Add one on the Tools page first.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {servers.map((s) => {
        const keys = s.tools.map((t) => keyOf({ serverId: s._id, tool: t.name }));
        return (
          <div key={s._id} className="flex flex-col gap-1.5">
            <Checkbox
              checked={keys.length > 0 && keys.every((k) => chosen.has(k))}
              onCheckedChange={(on) => toggle(keys, on)}
              label={<span className="text-body font-medium">{s.name}</span>}
            />
            <div className="flex flex-col gap-1 pl-6">
              {s.tools.map((t, i) => (
                <Checkbox
                  key={t.name}
                  checked={chosen.has(keys[i])}
                  onCheckedChange={(on) => toggle([keys[i]], on)}
                  label={<span className="tc-mono truncate text-mono-sm">{t.name}</span>}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const toolKey = keyOf;

export function ToolPickerButton({ picker }: { picker: ReturnType<typeof useToolPicker> }) {
  const { servers, chosen, setChosen } = picker;
  return (
    <Popover
      side="top"
      title="Tools for this thread"
      className="max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto"
      trigger={
        <button type="button" className="tc-picker" aria-label={`Tools: ${chosen.size} selected`}>
          <IconTool size={14} stroke={1.75} />
          Tools
          <span className="tc-num">{chosen.size}</span>
        </button>
      }
    >
      <p className="mb-3 text-body-sm text-foreground-muted">
        The thread keeps exactly these when you send the first message. Changing them later rewrites the cache.
      </p>
      <ToolChecklist servers={servers} chosen={chosen} onChange={setChosen} />
    </Popover>
  );
}
