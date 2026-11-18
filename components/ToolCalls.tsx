"use client";

import { IconChevronRight, IconTool } from "@tabler/icons-react";
import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/feedback";

type Status = "running" | "notRun" | "ok" | "error" | "declined" | "timedOut";
const CHIP: Record<Status, { label: string; tone?: BadgeTone }> = {
  running: { label: "running", tone: "live" },
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
