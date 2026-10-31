"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { api } from "@/convex/_generated/api";

export default function ChatShell({ children }: { children: React.ReactNode }) {
  const threads = useQuery(api.chat.listThreads);
  const { threadId } = useParams<{ threadId?: string }>();

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-3 py-2 md:flex">
          <Link href="/" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-line/60">
            + New thread
          </Link>
          {threads?.map((t) => (
            <Link
              key={t._id}
              href={`/t/${t._id}`}
              className={`truncate rounded-lg px-3 py-2 text-sm hover:bg-line/60 ${t._id === threadId ? "bg-line/60 text-foreground" : "text-muted"}`}
            >
              {t.title}
            </Link>
          ))}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
