"use client";

import { IconChevronRight, IconTool } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/fields";

type Status = "running" | "waiting" | "notRun" | "ok" | "error" | "declined" | "timedOut";
const CHIP: Record<Status, { label: string; tone?: BadgeTone }> = {
  running: { label: "running", tone: "live" },
  waiting: { label: "waiting", tone: "warning" },
  notRun: { label: "not run" },
  ok: { label: "done", tone: "success" },
  error: { label: "failed", tone: "danger" },
  declined: { label: "declined", tone: "warning" },
  timedOut: { label: "timed out", tone: "danger" },
};

/** One tool call in a reply: name, server and status, with its arguments and result a click away. */
export function ToolCallRow({
  tool,
  server,
  status,
  input,
  result,
}: {
  tool: string;
  server: string | null;
  status: Status;
  input: string;
  result?: string;
}) {
  const [open, setOpen] = useState(false);
  const chip = CHIP[status];
  return (
    <div className="tc-toolcall" data-status={status}>
      <button type="button" className="tc-toolcall-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconChevronRight size={14} stroke={1.75} className="tc-toolcall-chevron" aria-hidden />
        <IconTool size={14} stroke={1.5} className="shrink-0 text-foreground-subtle" aria-hidden />
        <span className="tc-mono truncate text-mono-sm text-foreground">{tool}</span>
        {server && <span className="truncate text-body-sm text-foreground-muted">{server}</span>}
        <span className="flex-1" />
        <Badge tone={chip.tone} dot={status === "running"}>
          {chip.label}
        </Badge>
      </button>
      {open && (
        <div className="tc-toolcall-body tc-fade-in">
          <p className="text-overline text-foreground-muted uppercase">Arguments</p>
          <pre className="tc-toolcall-pre">{input}</pre>
          {result !== undefined && (
            <>
              <p className="text-overline text-foreground-muted uppercase">Result</p>
              <pre className="tc-toolcall-pre">{result || "(empty)"}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Pending = { id: string; tool: string; server: string | null; input: string; alwaysAllowed: boolean };

/**
 * The prompt for one step (spec phase 10): every call the model made at once, with its arguments.
 * Allow runs them all except the ones ticked "Decline", which tell the model so.
 */
export function ApprovalPrompt({
  calls,
  onAnswer,
}: {
  calls: Pending[];
  onAnswer: (declined: string[]) => Promise<unknown>;
}) {
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(declined);
    if (on) next.add(id);
    else next.delete(id);
    setDeclined(next);
  };
  const answer = (ids: string[]) => {
    setBusy(true);
    void onAnswer(ids).catch(() => setBusy(false));
  };
  const allowed = calls.length - declined.size;
  return (
    <section className="tc-approval tc-pop-in" role="group" aria-label="Tool calls waiting for approval">
      <div>
        <h3 className="text-label">
          {calls.length === 1 ? "Allow this tool call?" : `Allow these ${calls.length} tool calls?`}
        </h3>
        <p className="mt-0.5 text-body-sm text-foreground-muted">
          The reply is paused and keeps your cache warm. It stops after 30 minutes without an answer.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {calls.map((c) => (
          <div key={c.id} className="tc-approval-call" data-declined={declined.has(c.id) || undefined}>
            <div className="flex items-center gap-2">
              <span className="tc-mono truncate text-mono-sm text-foreground">{c.tool}</span>
              {c.server && <span className="truncate text-body-sm text-foreground-muted">{c.server}</span>}
              {c.alwaysAllowed && <Badge>always allowed</Badge>}
              <span className="flex-1" />
              <Checkbox checked={declined.has(c.id)} onCheckedChange={(on) => toggle(c.id, on)} label="Decline" />
            </div>
            <pre className="tc-toolcall-pre">{c.input}</pre>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" loading={busy} onClick={() => answer([...declined])}>
          {allowed === 0 ? "Send as declined" : allowed === calls.length ? "Allow" : `Allow ${allowed}`}
        </Button>
        {allowed > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => answer(calls.map((c) => c.id))}>
            Decline all
          </Button>
        )}
      </div>
    </section>
  );
}
