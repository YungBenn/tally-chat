"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState } from "react";
import ChatShell from "@/components/ChatShell";
import { Button } from "@/components/wensity/button";
import { NativeSelect } from "@/components/wensity/native-select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const SOURCE = { chatgpt: "ChatGPT", claude: "Claude" } as const;
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
        label: `${p.name} · ${m.displayName}`,
      })),
  );
  const selected = choice ?? options[0]?.value;

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(await uploadUrl(), {
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
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Import
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bring your conversations from ChatGPT or Claude. Each one becomes
              a thread with its title, date and branches, and costs nothing:
              imported messages never count as spend.
            </p>
          </div>
          <form
            data-surface="panel"
            className="flex flex-col gap-5 rounded-[var(--primitive-radius-surface)] p-5"
            onSubmit={(e) => void onImport(e)}
          >
            <div className="flex flex-col gap-2">
              <label
                htmlFor="import-file"
                className="text-[13px] font-medium leading-none"
              >
                Conversations file
              </label>
              <input
                ref={fileInput}
                id="import-file"
                type="file"
                accept=".json,application/json"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm file:mr-3 file:cursor-pointer file:rounded-[var(--primitive-radius-control)] file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-primitive-surface-hover"
              />
              <ul className="list-disc pl-5 text-xs leading-5 text-muted-foreground">
                <li>
                  ChatGPT: Settings → Data controls → Export data. Unzip the
                  download and pick <code>conversations.json</code>.
                </li>
                <li>
                  Claude: Settings → Privacy → Export data. Unzip the download
                  and pick <code>conversations.json</code>.
                </li>
              </ul>
            </div>
            <NativeSelect
              label="Continue on"
              hint="Imported threads reply on this model. Images and files in the export become placeholders."
              value={selected ?? ""}
              onChange={(e) => setChoice(e.target.value)}
              options={options}
              disabled={options.length === 0}
            />
            {error && (
              <p role="alert" className="text-sm text-primitive-destructive">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={!file || !selected || busy}>
                {busy ? "Uploading…" : "Import"}
              </Button>
            </div>
          </form>
          {imports && imports.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold tracking-[-0.01em]">
                Recent imports
              </h2>
              <ul className="flex flex-col">
                {imports.map((i) => (
                  <li
                    key={i._id}
                    className="flex flex-col gap-0.5 border-t border-border py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {i.fileName}
                        {i.source && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {SOURCE[i.source]}
                          </span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 text-xs ${i.status === "failed" ? "text-primitive-destructive" : "text-muted-foreground"}`}
                      >
                        {STATUS[i.status]}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
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
                      <span className="text-xs text-primitive-destructive">
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
