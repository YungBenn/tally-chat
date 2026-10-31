"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/convex/_generated/api";

function ThreadList({ onNavigate }: { onNavigate?: () => void }) {
  const threads = useQuery(api.chat.listThreads);
  const { threadId } = useParams<{ threadId?: string }>();
  return (
    <>
      <Link href="/" onClick={onNavigate} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-line/60">
        + New thread
      </Link>
      {threads?.map((t) => (
        <Link
          key={t._id}
          href={`/t/${t._id}`}
          onClick={onNavigate}
          className={`truncate rounded-lg px-3 py-2 text-sm hover:bg-line/60 ${t._id === threadId ? "bg-line/60 text-foreground" : "text-muted"}`}
        >
          {t.title}
        </Link>
      ))}
    </>
  );
}

export default function ChatShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-3 py-2 md:flex">
          <ThreadList />
        </aside>
        {/* Below md the thread list is a drawer (design doc section 12). */}
        {drawerOpen && (
          <div className="fixed inset-0 z-20 md:hidden">
            <button aria-label="Close threads" className="absolute inset-0 bg-foreground/20" onClick={() => setDrawerOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-1 overflow-y-auto bg-background px-3 py-3 shadow-xl">
              <ThreadList onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <button
            onClick={() => setDrawerOpen(true)}
            className="mx-4 mt-2 cursor-pointer self-start rounded-lg px-2 py-1 text-sm text-muted hover:bg-line/60 hover:text-foreground md:hidden"
          >
            ☰ Threads
          </button>
          {children}
        </main>
      </div>
    </div>
  );
}
