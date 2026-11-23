"use client";

import { IconTool } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Checkbox } from "@/components/ui/fields";
import { Popover } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import type { BuiltinPick, ToolPick } from "@/convex/lib/toolSet";

const keyOf = (p: Exclude<ToolPick, BuiltinPick>) => `${p.serverId}|${p.tool}`;
const skillKey = (name: string) => `skill|${name}`;
const ADD_SKILL = "builtin|add_skill";
// About the size of read_skill's preamble and input schema, before the catalog lines.
const READ_SKILL_CHARS = 520;
// About the size of add_skill's description and input schema.
const ADD_SKILL_TOKENS = 150;

/**
 * The tools a new thread will freeze at its first message (spec phase 10): every tool of the
 * servers that are on for new threads, read_skill with the skills that are on, and add_skill when
 * its setting is on (it can be picked either way), until the owner changes the picks. Offered
 * only for a tool-capable model.
 */
export function useToolPicker(capable: boolean) {
  const servers = useQuery(api.toolServers.list);
  const skills = useQuery(api.skills.list);
  const addSkillDefault = useQuery(api.settings.get)?.addSkillOnForNewThreads === true;
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const defaults = new Set([
    ...(addSkillDefault ? [ADD_SKILL] : []),
    ...(skills ?? []).filter((s) => s.onForNewThreads).map((s) => skillKey(s.name)),
    ...(servers ?? []).filter((s) => s.onForNewThreads).flatMap((s) => s.tools.map((t) => keyOf({ serverId: s._id, tool: t.name }))),
  ]);
  const chosen = picked ?? defaults;
  const picks = picksOf(servers ?? [], skills ?? [], chosen);
  const chosenSkills = (skills ?? []).filter((s) => chosen.has(skillKey(s.name)));
  return {
    available: capable, // add_skill is always there to pick
    servers: servers ?? [],
    skills: skills ?? [],
    chosen,
    count: picks.length,
    // What the send carries: undefined when the model can't call tools, else the explicit picks.
    picks: capable ? picks : undefined,
    // Rough tokens of the chosen definitions: they go out with the first request.
    tokens: capable
      ? (servers ?? []).flatMap((s) => s.tools.filter((t) => chosen.has(keyOf({ serverId: s._id, tool: t.name })))).reduce((sum, t) => sum + t.tokens, 0) +
        (chosenSkills.length
          ? Math.ceil(chosenSkills.reduce((sum, s) => sum + s.name.length + s.description.length + 5, READ_SKILL_CHARS) / 4)
          : 0) +
        (chosen.has(ADD_SKILL) ? ADD_SKILL_TOKENS : 0)
      : 0,
    setChosen: setPicked,
  };
}

type Servers = FunctionReturnType<typeof api.toolServers.list>;
type Skills = { name: string }[];

/** The picks the chosen keys stand for: read_skill with its skills, add_skill, then each server tool. */
export function picksOf(servers: Servers, skills: Skills, chosen: Set<string>): ToolPick[] {
  const names = skills.map((s) => s.name).filter((n) => chosen.has(skillKey(n)));
  return [
    ...(names.length ? [{ builtin: "read_skill", skills: names }] : []),
    ...(chosen.has(ADD_SKILL) ? [{ builtin: "add_skill" }] : []),
    ...servers.flatMap((s) => s.tools.map((t) => ({ serverId: s._id, tool: t.name })).filter((p) => chosen.has(keyOf(p)))),
  ];
}

/** The keys a thread's current picks stand for, to start the checklist from. */
export const keysOf = (picks: ToolPick[]) =>
  new Set(
    picks.flatMap((p) =>
      "builtin" in p ? (p.builtin === "add_skill" ? [ADD_SKILL] : (p.skills ?? []).map(skillKey)) : [keyOf(p)],
    ),
  );

/**
 * add_skill, read_skill with each skill under it, then every tool server with its tools, as
 * checkboxes; a group's box toggles all of its items.
 */
export function ToolChecklist({
  servers,
  skills,
  chosen,
  onChange,
}: {
  servers: Servers;
  skills: Skills;
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
  const groups = [
    ...(skills.length
      ? [{ id: "read_skill", label: <>Skills <span className="tc-mono text-mono-sm font-normal text-foreground-muted">read_skill</span></>, items: skills.map((s) => ({ name: s.name, key: skillKey(s.name) })) }]
      : []),
    ...servers.map((s) => ({ id: s._id, label: s.name, items: s.tools.map((t) => ({ name: t.name, key: keyOf({ serverId: s._id, tool: t.name }) })) })),
  ];
  return (
    <div className="flex flex-col gap-3">
      <Checkbox
        checked={chosen.has(ADD_SKILL)}
        onCheckedChange={(on) => toggle([ADD_SKILL], on)}
        label={
          <span className="text-body font-medium">
            Add skills from chat <span className="tc-mono text-mono-sm font-normal text-foreground-muted">add_skill</span>
          </span>
        }
      />
      {groups.map((g) => {
        const keys = g.items.map((i) => i.key);
        return (
          <div key={g.id} className="flex flex-col gap-1.5">
            <Checkbox
              checked={keys.length > 0 && keys.every((k) => chosen.has(k))}
              onCheckedChange={(on) => toggle(keys, on)}
              label={<span className="text-body font-medium">{g.label}</span>}
            />
            <div className="flex flex-col gap-1 pl-6">
              {g.items.map((i) => (
                <Checkbox
                  key={i.key}
                  checked={chosen.has(i.key)}
                  onCheckedChange={(on) => toggle([i.key], on)}
                  label={<span className="tc-mono truncate text-mono-sm">{i.name}</span>}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ToolPickerButton({ picker }: { picker: ReturnType<typeof useToolPicker> }) {
  const { servers, skills, chosen, count, setChosen } = picker;
  return (
    <Popover
      side="top"
      title="Tools for this thread"
      className="max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto"
      trigger={
        <button type="button" className="tc-picker" aria-label={`Tools: ${count} selected`}>
          <IconTool size={14} stroke={1.75} />
          Tools
          <span className="tc-num">{count}</span>
        </button>
      }
    >
      <p className="mb-3 text-body-sm text-foreground-muted">
        The thread keeps exactly these when you send the first message. Changing them later rewrites the cache.
      </p>
      <ToolChecklist servers={servers} skills={skills} chosen={chosen} onChange={setChosen} />
    </Popover>
  );
}
