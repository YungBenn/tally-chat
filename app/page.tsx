"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ChatShell from "@/components/ChatShell";
import Composer from "@/components/Composer";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function NewThread() {
  const providers = useQuery(api.providers.list);
  const createThread = useMutation(api.chat.createThread);
  const send = useMutation(api.chat.send);
  const router = useRouter();
  const options = (providers ?? []).flatMap((p) =>
    p.models.filter((m) => !m.hidden).map((m) => ({ value: `${p._id}|${m.id}`, label: `${p.name} · ${m.displayName}` })),
  );
  const [choice, setChoice] = useState<string | null>(null);
  const selected = choice ?? options[0]?.value;

  return (
    <ChatShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
        <h1 className="font-serif text-2xl">What are we working on?</h1>
        {providers && options.length === 0 ? (
          <p className="text-sm text-muted">
            <Link href="/providers" className="underline underline-offset-2 hover:text-foreground">
              Add a provider
            </Link>{" "}
            to start a thread.
          </p>
        ) : (
          <label className="flex items-center gap-2 text-sm text-muted">
            Model
            <select
              value={selected ?? ""}
              onChange={(e) => setChoice(e.target.value)}
              className="rounded-lg border border-line bg-card px-2 py-1 text-foreground"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Composer
        disabled={!selected}
        onSend={async (text) => {
          if (!selected) return;
          const [providerId, modelId] = selected.split("|");
          try {
            const threadId = await createThread({ providerId: providerId as Id<"providers">, modelId });
            await send({ threadId, content: text });
            router.push(`/t/${threadId}`);
          } catch (err) {
            throw new Error(err instanceof ConvexError ? String(err.data) : "Could not send");
          }
        }}
      />
    </ChatShell>
  );
}
