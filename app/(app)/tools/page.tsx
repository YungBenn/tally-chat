"use client";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconTool,
  IconX,
} from "@tabler/icons-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import AppPage from "@/components/ChatShell";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Input, Switch } from "@/components/ui/fields";
import { Dialog } from "@/components/ui/overlay";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const errorText = (err: unknown, fallback = "Something went wrong") =>
  err instanceof ConvexError ? String(err.data) : fallback;
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

type Server = NonNullable<ReturnType<typeof useQuery<typeof api.toolServers.list>>>[number];
type Header = { name: string; value: string };

export default function ToolsPage() {
  const servers = useQuery(api.toolServers.list);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<Id<"toolServers"> | null>(null);
  const open = servers?.find((s) => s._id === openId);

  return (
    <AppPage>
      <div className="tc-page">
        <div className="tc-page-col max-w-[880px]">
          {open ? (
            <ServerDetail server={open} onBack={() => setOpenId(null)} />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h1 className="flex-1 text-title">Tools</h1>
                {!adding && servers && servers.length > 0 && (
                  <Button variant="primary" icon={<IconPlus />} onClick={() => setAdding(true)}>
                    Add a tool server
                  </Button>
                )}
              </div>
              <p className="-mt-2 text-body-sm text-foreground-muted">
                Remote MCP servers give the model tools to call. New threads start with the servers switched on here.
              </p>
              {(adding || servers?.length === 0) && (
                <ServerForm onDone={() => setAdding(false)} canCancel={!!servers?.length} />
              )}
              {servers && servers.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {servers.map((s) => (
                    <ServerCard key={s._id} server={s} onOpen={() => setOpenId(s._id)} />
                  ))}
                </div>
              )}
              {servers?.length === 0 && !adding && (
                <EmptyState
                  title="No tool servers yet"
                  description="Add one above. Header values such as a bearer token are encrypted and stay on your server."
                />
              )}
            </>
          )}
        </div>
      </div>
    </AppPage>
  );
}

function ServerCard({ server, onOpen }: { server: Server; onOpen: () => void }) {
  const setOn = useMutation(api.toolServers.setOnForNewThreads);
  const failed = server.lastTest?.ok === false;
  return (
    <div className="tc-card tc-provider holo-ring text-left">
      <button type="button" className="tc-provider-head text-left" onClick={onOpen}>
        <span className="tc-provider-logo">
          <IconTool size={18} stroke={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="tc-provider-name truncate">{server.name}</div>
          <div className="tc-provider-url truncate">{server.url}</div>
        </div>
        {failed ? (
          <Badge tone="danger" icon={<IconAlertTriangle size={12} stroke={1.5} />}>
            Unreachable
          </Badge>
        ) : (
          <Badge tone="success" icon={<IconCircleCheck size={12} stroke={1.5} />}>
            {server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}
          </Badge>
        )}
      </button>
      <Switch
        checked={server.onForNewThreads}
        onCheckedChange={(on) => void setOn({ serverId: server._id, on })}
        label="On for new threads"
      />
    </div>
  );
}

// Header rows: values are write-only. An edit starts from the stored names with empty values, and
// a changed set replaces the stored one.
function HeaderRows({ rows, onChange }: { rows: Header[]; onChange: (rows: Header[]) => void }) {
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="tc-field-label">Headers</span>
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <Input
            mono
            aria-label="Header name"
            placeholder="Authorization"
            value={row.name}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
            fieldClassName="flex-1"
          />
          <Input
            mono
            type="password"
            autoComplete="off"
            aria-label="Header value"
            placeholder="Bearer …"
            value={row.value}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
            fieldClassName="flex-[2]"
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Remove header"
            icon={<IconX />}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" icon={<IconPlus />} onClick={() => onChange([...rows, { name: "", value: "" }])}>
          Add a header
        </Button>
      </div>
      <p className="text-caption text-foreground-subtle">Encrypted at rest and never shown again.</p>
    </div>
  );
}

function ServerForm({ server, onDone, canCancel }: { server?: Server; onDone: () => void; canCancel: boolean }) {
  const add = useAction(api.toolServerActions.add);
  const edit = useAction(api.toolServerActions.edit);
  const [headers, setHeaders] = useState<Header[]>([]);
  const [headersTouched, setHeadersTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaving(true);
    setError(null);
    const args = { name: String(form.get("name")), url: String(form.get("url")) };
    // Decided before the try: React Compiler can't compile a ternary inside one.
    const editHeaders = headersTouched ? { headers } : {};
    const title = server ? "Tool server saved" : "Tool server added";
    try {
      if (server) await edit({ serverId: server._id, ...args, ...editHeaders });
      else await add({ ...args, headers });
      toast({ title, body: "The server answered and its tools are listed." });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not reach the server"));
    }
    setSaving(false);
  }

  return (
    <section className="tc-card tc-pop-in flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-heading">{server ? `Edit ${server.name}` : "Add a tool server"}</h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          A remote MCP server over Streamable HTTP. For a local stdio server, run it behind a proxy; the{" "}
          <Link href="https://github.com/YungBenn/tally-chat/blob/main/docs/self-hosting.md" className="text-accent underline underline-offset-2">
            self-hosting guide
          </Link>{" "}
          shows how.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <Input label="Name" name="name" defaultValue={server?.name} placeholder="Docs search" required />
        <Input label="URL" mono name="url" defaultValue={server?.url} placeholder="https://mcp.example.com/mcp" required />
        {server && !headersTouched ? (
          <div className="flex flex-col items-start gap-1.5 sm:col-span-2">
            <span className="tc-field-label">Headers</span>
            <p className="text-body-sm text-foreground-muted">
              {server.headerNames.length ? server.headerNames.join(", ") : "None"} (values are hidden)
            </p>
            <Button variant="outline" size="sm" onClick={() => setHeadersTouched(true)}>
              Replace headers
            </Button>
          </div>
        ) : (
          <HeaderRows rows={headers} onChange={setHeaders} />
        )}
        <p className="text-caption text-foreground-subtle sm:col-span-2">
          Private or http addresses must be on the{" "}
          <a href="#settings/network" className="text-accent underline underline-offset-2">
            private host allowlist
          </a>{" "}
          first.
        </p>
        {error && (
          <div role="alert" className="tc-fade-in tc-inline-error sm:col-span-2">
            <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
            <span>
              <strong>Could not connect.</strong> {sentence(error)} Nothing was saved.
            </span>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? "Connecting…" : "Test and save"}
          </Button>
          {canCancel && (
            <Button variant="ghost" onClick={onDone} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function ServerDetail({ server, onBack }: { server: Server; onBack: () => void }) {
  const setOn = useMutation(api.toolServers.setOnForNewThreads);
  const setAllowed = useMutation(api.toolServers.setAlwaysAllowed);
  const remove = useMutation(api.toolServers.remove);
  const refresh = useAction(api.toolServerActions.refresh);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const failed = server.lastTest?.ok === false;

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={onBack}>
          Tools
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-title">{server.name}</h1>
        <Badge tone={failed ? "danger" : "success"} dot>
          {failed ? "Unreachable" : "Connected"}
        </Badge>
        <span className="flex-1" />
        <Button variant="ghost" icon={<IconPencil />} onClick={() => setEditing(!editing)}>
          Edit
        </Button>
        <Button variant="ghost" icon={<IconTrash />} onClick={() => setDeleting(true)}>
          Delete
        </Button>
      </div>
      {editing && <ServerForm server={server} onDone={() => setEditing(false)} canCancel />}
      <div className="tc-card grid gap-5 p-5 md:grid-cols-2 md:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-overline text-foreground-muted uppercase">URL</p>
          <p className="tc-mono truncate text-mono" title={server.url}>
            {server.url}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-overline text-foreground-muted uppercase">Headers</p>
          <p className="tc-mono truncate text-mono">{server.headerNames.join(", ") || "none"}</p>
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Switch
            checked={server.onForNewThreads}
            onCheckedChange={(on) => void setOn({ serverId: server._id, on })}
            label="On for new threads"
          />
          <p className="pl-[38px] text-body-sm text-foreground-muted">
            Every request in a thread carries its tools&apos; definitions, so a server you don&apos;t need adds to each
            turn&apos;s cost. Threads already started keep the tools they began with.
          </p>
        </div>
      </div>
      {failed && (
        <div role="alert" className="tc-fade-in tc-inline-error">
          <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
          <span>
            <strong>The last test failed.</strong> {sentence(server.lastTest?.error ?? "No answer")} The tool list below is
            from the last time it worked.
          </span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-heading">Tools</h2>
        <span className="tc-mono text-mono-sm text-foreground-muted">
          {server.tools.length} offered · {server.alwaysAllowed.length} always allowed
        </span>
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefresh />}
          loading={busy}
          title="Connect again and re-read the tool list"
          onClick={() => {
            setBusy(true);
            void refresh({ serverId: server._id }).finally(() => setBusy(false));
          }}
        >
          Test and refresh
        </Button>
      </div>
      {server.tools.length === 0 ? (
        <EmptyState title="This server offers no tools" description="Refresh once it has some." />
      ) : (
        <div className="tc-models">
          <div className="tc-tools-row tc-models-head">
            <span>Tool</span>
            <span>Always allow</span>
          </div>
          {server.tools.map((t) => (
            <div key={t.name} className="tc-tools-row">
              <div className="min-w-0">
                <p className="tc-mono truncate text-mono-sm">{t.name}</p>
                {t.description && <p className="line-clamp-2 text-body-sm text-foreground-muted">{t.description}</p>}
              </div>
              <Switch
                aria-label={`Always allow ${t.name}`}
                checked={server.alwaysAllowed.includes(t.name)}
                onCheckedChange={(allowed) => void setAllowed({ serverId: server._id, tool: t.name, allowed })}
              />
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        tone="danger"
        icon={<IconTrash size={18} stroke={1.5} />}
        title={`Delete ${server.name}?`}
        description="Its headers are removed from this instance. Threads that already carry its tools keep their history."
        actions={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleting(false);
                onBack();
                void remove({ serverId: server._id });
              }}
            >
              Delete server
            </Button>
          </>
        }
      />
    </>
  );
}
