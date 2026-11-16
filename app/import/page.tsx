"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState } from "react";
import { reachable } from "@/lib/backendUrl";
import ChatShell from "@/components/ChatShell";
import { IconFileUpload } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge, ProgressBar, type BadgeTone } from "@/components/ui/feedback";
import { Select } from "@/components/ui/fields";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const SOURCE = { chatgpt: "ChatGPT", claude: "Claude" } as const;
const TONE: Record<
  "queued" | "running" | "done" | "failed",
  BadgeTone | undefined
> = {
  queued: undefined,
  running: "info",
  done: "success",
  failed: "danger",
};
const STATUS = {
  queued: "Queued",
  running: "Importing",
  done: "Done",
  failed: "Failed",
} as const;

// Import (spec phase 7): a ChatGPT or Claude conversations.json becomes threads, in the
// background. Imported messages carry no cost and never count as spend.
export default function ImportPage() {
  const providers = useQuery(api.providers.list);
  const imports = useQuery(api.imports.list);
  const uploadUrl = useMutation(api.imports.generateUploadUrl);
  const start = useMutation(api.imports.start);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = (providers ?? []).flatMap((p) =>
    p.models
      .filter((m) => !m.hidden)
      .map((m) => ({
        value: `${p._id}|${m.id}`,
        label: m.displayName,
        group: p.name,
      })),
  );
  const selected = choice ?? options[0]?.value;

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(reachable(await uploadUrl()), {
        method: "POST",
        headers: { "Content-Type": file.type || "application/json" },
        body: file,
      });
      if (!res.ok) throw new Error("Could not upload the file");
      const { storageId } = (await res.json()) as {
        storageId: Id<"_storage">;
      };
      const [providerId, modelId] = selected.split("|");
      await start({
        storageId,
        fileName: file.name,
        providerId: providerId as Id<"providers">,
        modelId,
      });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      setError(
        err instanceof ConvexError
          ? String(err.data)
          : err instanceof Error
            ? err.message
            : "Could not start the import",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ChatShell>
      <div className="tc-page">
        <div className="tc-page-col max-w-[800px]">
          <div>
            <h1 className="text-title">Import</h1>
            <p className="mt-2 text-body text-foreground-muted">
              Bring your conversations from ChatGPT or Claude. Each one becomes
              a thread with its title, date and branches, and costs nothing:
              imported messages never count as spend.
            </p>
          </div>
          <form
            className="tc-card flex flex-col gap-5 p-5"
            onSubmit={(e) => void onImport(e)}
          >
            <div className="flex flex-col gap-2">
              <span className="tc-field-label">Conversations file</span>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  icon={<IconFileUpload />}
                  onClick={() => fileInput.current?.click()}
                >
                  Choose file
                </Button>
                <span
                  className={
                    file
                      ? "tc-mono text-mono-sm"
                      : "text-body-sm text-foreground-subtle"
                  }
                >
                  {file ? file.name : "No file chosen"}
                </span>
                <input
                  ref={fileInput}
                  id="import-file"
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label="Conversations file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <ul className="list-disc pl-5 text-caption leading-5 text-foreground-muted">
                <li>
                  ChatGPT: Settings → Data controls → Export data. Unzip the
                  download and pick{" "}
                  <code className="tc-mono">conversations.json</code>.
                </li>
                <li>
                  Claude: Settings → Privacy → Export data. Unzip the download
                  and pick <code className="tc-mono">conversations.json</code>.
                </li>
              </ul>
            </div>
            <Select
              label="Continue on"
              help="Imported threads reply on this model. Images and files in the export become placeholders."
              value={selected ?? null}
              onValueChange={setChoice}
              options={options}
              disabled={options.length === 0}
            />
            {error && (
              <p role="alert" className="tc-inline-error tc-fade-in">
                {error}
              </p>
            )}
            <div>
              <Button
                type="submit"
                variant="primary"
                disabled={!file || !selected || busy}
                loading={busy}
              >
                {busy ? "Uploading…" : "Import"}
              </Button>
            </div>
          </form>
          {imports && imports.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-heading">Recent imports</h2>
              <ul className="tc-card flex flex-col px-4">
                {imports.map((i) => (
                  <li
                    key={i._id}
                    className="flex flex-col gap-1 border-b border-border-subtle py-3 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-label">
                        {i.fileName}
                        {i.source && (
                          <span className="font-normal text-foreground-muted">
                            {" "}
                            · {SOURCE[i.source]}
                          </span>
                        )}
                      </span>
                      <Badge tone={TONE[i.status]} dot>
                        {STATUS[i.status]}
                      </Badge>
                    </div>
                    {i.status === "running" &&
                      i.total !== undefined &&
                      i.total > 0 && (
                        <ProgressBar
                          plain
                          value={((i.imported + i.skipped) / i.total) * 100}
                          label={`${i.imported + i.skipped} of ${i.total} conversations`}
                        />
                      )}
                    <span className="tc-mono text-mono-sm text-foreground-muted">
                      {[
                        i.status === "running" && i.total !== undefined
                          ? `${i.imported + i.skipped} of ${i.total}`
                          : null,
                        `${i.imported} imported`,
                        i.skipped > 0 ? `${i.skipped} already here` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {i.error && (
                      <span className="text-body-sm text-danger">
                        {i.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </ChatShell>
  );
}
