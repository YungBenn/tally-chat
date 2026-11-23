"use client";

import { IconAlertTriangle, IconBrandGithub, IconEye, IconRefresh, IconTrash, IconUpload } from "@tabler/icons-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Switch } from "@/components/ui/fields";
import { Dialog } from "@/components/ui/overlay";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseSkill, type SkillFile } from "@/convex/lib/skills";
import { bytes } from "@/lib/format";
import { unzipSkill } from "@/lib/skillZip";

type Skill = NonNullable<ReturnType<typeof useQuery<typeof api.skills.list>>>[number];
type AddResult = Awaited<ReturnType<ReturnType<typeof useMutation<typeof api.skills.addFromFiles>>>>;
type Send = (replace: boolean) => Promise<AddResult>;

/** Settings › Skills: upload a SKILL.md or a zip, or add one from GitHub; then view, switch, refresh or delete each skill. */
export default function SkillsSettings() {
  const skills = useQuery(api.skills.list);
  const add = useMutation(api.skills.addFromFiles);
  const addGithub = useAction(api.skillActions.addFromGithub);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{ name: string; send: Send } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Id<"skills"> | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);

  // Every way of adding answers added, exists (confirm, then send again with replace) or invalid.
  async function submit(send: Send, replace: boolean) {
    setBusy(true);
    setError(null);
    const result = await send(replace).finally(() => setBusy(false));
    if (result.status === "invalid") setError(result.reason);
    else if (result.status === "exists") setReplacing({ name: result.name, send });
    else toast({ title: replace ? "Skill replaced" : "Skill added", body: "New threads can read it." });
    return result.status === "added";
  }

  function upload(files: SkillFile[]) {
    setError(null);
    // Checked here too, so an oversized zip is refused before it is sent.
    const parsed = parseSkill(files);
    if (!parsed.ok) return setError(parsed.reason);
    return submit((replace) => add({ files, replace }), false);
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
              return upload([{ path: "SKILL.md", text: await file.text() }]);
            let files: SkillFile[];
            try {
              files = unzipSkill(new Uint8Array(await file.arrayBuffer()));
            } catch {
              return setError("The file is not a readable zip.");
            }
            await upload(files);
          }}
        />
      </div>
      <form
        className="flex items-start gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const url = String(new FormData(form).get("url"));
          if (await submit((replace) => addGithub({ url, replace }), false)) form.reset();
        }}
      >
        <Input
          mono
          name="url"
          type="url"
          required
          placeholder="https://github.com/anthropics/skills/tree/main/skills/pdf"
          aria-label="GitHub URL"
          help="A public GitHub folder holding a SKILL.md, the SKILL.md itself, or a repo."
          fieldClassName="flex-1"
        />
        <Button type="submit" icon={<IconBrandGithub />} loading={busy}>
          Add from GitHub
        </Button>
      </form>
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
                const send = replacing!.send;
                setReplacing(null);
                void submit(send, true);
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
  const refresh = useAction(api.skillActions.refresh);
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className="tc-tools-row">
      <div className="min-w-0">
        <p className="tc-mono truncate text-mono-sm">{skill.name}</p>
        <p className="line-clamp-2 text-body-sm text-foreground-muted">{skill.description}</p>
        <p className="tc-mono mt-0.5 text-mono-sm text-foreground-subtle">
          {bytes(skill.size)} ·{" "}
          {skill.source === "upload" ? (
            "uploaded"
          ) : (
            <a className="underline underline-offset-2" href={skill.source.github} target="_blank" rel="noopener noreferrer">
              {skill.source.github.replace("https://", "")}
            </a>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Switch
          aria-label={`${skill.name} on for new threads`}
          checked={skill.onForNewThreads}
          onCheckedChange={(on) => void setOn({ skillId: skill._id, on })}
          className="mr-2"
        />
        {skill.source !== "upload" && (
          <IconButton
            icon={<IconRefresh />}
            label={`Refresh ${skill.name} from GitHub`}
            size="sm"
            loading={refreshing}
            onClick={async () => {
              setRefreshing(true);
              const result = await refresh({ skillId: skill._id }).finally(() => setRefreshing(false));
              if (result.status === "invalid")
                toast({ title: `Could not refresh ${skill.name}`, body: result.reason, tone: "danger" });
              else toast({ title: `${skill.name} refreshed` });
            }}
          />
        )}
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
                      {bytes(f.size)}
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
