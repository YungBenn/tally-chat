"use client";

import { IconAlertTriangle, IconEye, IconRefresh, IconTrash, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/fields";
import { Dialog } from "@/components/ui/overlay";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseSkill, type SkillFile } from "@/convex/lib/skills";
import { unzipSkill } from "@/lib/skillZip";

type Skill = NonNullable<ReturnType<typeof useQuery<typeof api.skills.list>>>[number];

const formatSize = (bytes: number) =>
  bytes < 1000 ? `${bytes} B` : bytes < 1e6 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;

/** Settings › Skills: upload a SKILL.md or a zip of a skill folder, then view, switch or delete each skill. */
export default function SkillsSettings() {
  const skills = useQuery(api.skills.list);
  const add = useMutation(api.skills.addFromFiles);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{ name: string; files: SkillFile[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Id<"skills"> | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);

  async function upload(files: SkillFile[], replace: boolean) {
    setError(null);
    // Checked here too, so an oversized zip is refused before it is sent.
    const parsed = parseSkill(files);
    if (!parsed.ok) return setError(parsed.reason);
    setBusy(true);
    const result = await add({ files, replace });
    setBusy(false);
    if (result.status === "invalid") setError(result.reason);
    else if (result.status === "exists") setReplacing({ name: result.name, files });
    else toast({ title: replace ? "Skill replaced" : "Skill added", body: "New threads can read it." });
  }

  if (!skills) return null;
  return (
    <div className="flex flex-col gap-4 pt-1 pb-4">
      <div className="flex items-start gap-4">
        <p className="flex-1 text-body-sm text-foreground-muted">
          Instructions the model reads only when a task calls for them, in the{" "}
          <a
            className="text-accent underline underline-offset-2"
            href="https://agentskills.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            Agent Skills
          </a>{" "}
          format. New threads start with the skills switched on here; threads already started keep the ones they began
          with.
        </p>
        <Button variant="primary" icon={<IconUpload />} loading={busy} onClick={() => fileInput.current?.click()}>
          Upload skill
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".md,text/markdown,.zip,application/zip"
          hidden
          aria-label="SKILL.md or zip file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // picking the same file again still fires
            if (!file) return;
            if (!file.name.toLowerCase().endsWith(".zip"))
              // One .md file is the skill's SKILL.md, whatever the download was called.
              return upload([{ path: "SKILL.md", text: await file.text() }], false);
            let files: SkillFile[];
            try {
              files = unzipSkill(new Uint8Array(await file.arrayBuffer()));
            } catch {
              return setError("The file is not a readable zip.");
            }
            await upload(files, false);
          }}
        />
      </div>
      {error && (
        <div role="alert" className="tc-fade-in tc-inline-error">
          <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
          <span>
            <strong>Could not add the skill.</strong> {error} Nothing was saved.
          </span>
        </div>
      )}
      {skills.length === 0 ? (
        <EmptyState
          title="No skills yet"
          description="Upload a SKILL.md, or a zip of a skill folder with one inside: a name and description in YAML frontmatter, then the instructions."
        />
      ) : (
        <div className="tc-models">
          {skills.map((s) => (
            <SkillRow key={s._id} skill={s} onView={() => setViewing(s._id)} onDelete={() => setDeleting(s)} />
          ))}
        </div>
      )}
      <Dialog
        open={!!replacing}
        onOpenChange={(open) => !open && setReplacing(null)}
        icon={<IconRefresh size={18} stroke={1.5} />}
        title={`Replace existing skill ${replacing?.name}?`}
        description="A skill with this name already exists. Replacing it changes what threads read from now on; replies already written keep what they read."
        actions={
          <>
            <Button onClick={() => setReplacing(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const files = replacing!.files;
                setReplacing(null);
                void upload(files, true);
              }}
            >
              Replace skill
            </Button>
          </>
        }
      />
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        tone="danger"
        icon={<IconTrash size={18} stroke={1.5} />}
        title={`Delete ${deleting?.name}?`}
        description="Threads that list it get “this skill was removed” if the model tries to read it. What it already read stays."
        actions={<DeleteActions skill={deleting} onDone={() => setDeleting(null)} />}
      />
      <SkillView skillId={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function SkillRow({ skill, onView, onDelete }: { skill: Skill; onView: () => void; onDelete: () => void }) {
  const setOn = useMutation(api.skills.setOnForNewThreads);
  return (
    <div className="tc-tools-row">
      <div className="min-w-0">
        <p className="tc-mono truncate text-mono-sm">{skill.name}</p>
        <p className="line-clamp-2 text-body-sm text-foreground-muted">{skill.description}</p>
        <p className="tc-mono mt-0.5 text-mono-sm text-foreground-subtle">
          {formatSize(skill.size)} · uploaded
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Switch
          aria-label={`${skill.name} on for new threads`}
          checked={skill.onForNewThreads}
          onCheckedChange={(on) => void setOn({ skillId: skill._id, on })}
          className="mr-2"
        />
        <IconButton icon={<IconEye />} label={`View ${skill.name}`} size="sm" onClick={onView} />
        <IconButton icon={<IconTrash />} label={`Delete ${skill.name}`} size="sm" onClick={onDelete} />
      </div>
    </div>
  );
}

function DeleteActions({ skill, onDone }: { skill: Skill | null; onDone: () => void }) {
  const remove = useMutation(api.skills.remove);
  return (
    <>
      <Button onClick={onDone}>Cancel</Button>
      <Button
        variant="danger"
        onClick={() => {
          onDone();
          if (skill) void remove({ skillId: skill._id });
        }}
      >
        Delete skill
      </Button>
    </>
  );
}

function SkillView({ skillId, onClose }: { skillId: Id<"skills"> | null; onClose: () => void }) {
  const skill = useQuery(api.skills.get, skillId ? { skillId } : "skip");
  return (
    <Dialog
      open={!!skillId}
      onOpenChange={(open) => !open && onClose()}
      tone="info"
      icon={<IconEye size={18} stroke={1.5} />}
      title={skill?.name ?? "Skill"}
      description={skill?.description}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      {skill && (
        <div className="mt-4 flex flex-col gap-3">
          <pre className="tc-toolcall-pre">{skill.body || "(empty)"}</pre>
          <div>
            <p className="text-overline text-foreground-muted uppercase">Files</p>
            {skill.files.length === 0 ? (
              <p className="text-body-sm">Only SKILL.md.</p>
            ) : (
              <ul className="tc-hosts mt-1">
                {skill.files.map((f) => (
                  <li key={f.path}>
                    <span className="tc-mono truncate text-mono-sm">{f.path}</span>
                    <span className="tc-mono shrink-0 pr-2 text-mono-sm text-foreground-subtle">
                      {formatSize(f.size)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
