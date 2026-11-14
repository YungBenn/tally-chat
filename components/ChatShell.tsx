"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import {
  IconChartBar,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconPlug,
  IconSettings,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/wensity/button";
import { api } from "@/convex/_generated/api";
import { useStoredFlag } from "@/lib/storedFlag";
import { groupThreads } from "@/lib/threadGroups";
import { cn } from "@/lib/utils";

const row =
  "flex h-9 items-center gap-2.5 rounded-[var(--primitive-radius-item)] px-3 text-sm transition-colors hover:bg-primitive-surface-hover hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0";

function NewThreadButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      aria-label="New thread"
      title="New thread"
    >
      <Link href="/" onClick={onNavigate}>
        <IconEdit />
      </Link>
    </Button>
  );
}

function Sidebar({
  onClose,
  onNavigate,
  closeLabel,
}: {
  onClose: () => void;
  onNavigate?: () => void;
  closeLabel: string;
}) {
  const threads = useQuery(api.chat.listThreads);
  const { threadId } = useParams<{ threadId?: string }>();
  const path = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();

  return (
    <>
      <div className="flex h-13 shrink-0 items-center justify-between px-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <IconLayoutSidebarLeftCollapse />
        </Button>
        <NewThreadButton onNavigate={onNavigate} />
      </div>
      <nav
        aria-label="Threads"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {groupThreads(threads ?? []).map((g) => (
          <section key={g.label}>
            <h2 className="px-3 pt-4 pb-1.5 text-xs font-medium text-muted-foreground">
              {g.label}
            </h2>
            {g.threads.map((t) => (
              <Link
                key={t._id}
                href={`/t/${t._id}`}
                onClick={onNavigate}
                aria-current={t._id === threadId ? "page" : undefined}
                className={cn(
                  row,
                  "block truncate leading-9",
                  t._id === threadId
                    ? "bg-primitive-surface-selected text-foreground"
                    : "text-foreground/80",
                )}
              >
                {t.title}
              </Link>
            ))}
          </section>
        ))}
        {threads?.length === 0 && (
          <p className="px-3 pt-4 text-sm text-muted-foreground">
            No threads yet.
          </p>
        )}
      </nav>
      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border p-2">
        {[
          { href: "/usage", label: "Usage", icon: <IconChartBar /> },
          { href: "/providers", label: "Providers", icon: <IconPlug /> },
          { href: "/settings", label: "Settings", icon: <IconSettings /> },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={onNavigate}
            aria-current={path === l.href ? "page" : undefined}
            className={cn(
              row,
              path === l.href
                ? "bg-primitive-surface-selected text-foreground"
                : "text-muted-foreground",
            )}
          >
            {l.icon}
            {l.label}
          </Link>
        ))}
        <button
          className={cn(row, "text-muted-foreground")}
          onClick={() => void signOut().then(() => router.push("/signin"))}
        >
          <IconLogout />
          Log out
        </button>
      </div>
    </>
  );
}

// The app frame: thread sidebar (a drawer below md) and a main column whose top bar holds `header`.
export default function ChatShell({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useStoredFlag(
    "tally.sidebarOpen",
    true,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const settings = useQuery(api.settings.get);
  const setTimeZone = useMutation(api.settings.setTimeZone);

  // Daily spend uses the owner's day; record the browser's time zone the first time.
  useEffect(() => {
    if (settings && settings.timeZone === null) {
      void setTimeZone({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    }
  }, [settings, setTimeZone]);

  return (
    <div className="flex h-dvh">
      {sidebarOpen && (
        <aside className="hidden w-65 shrink-0 flex-col border-r border-border bg-surface-muted md:flex">
          <Sidebar
            closeLabel="Close sidebar"
            onClose={() => setSidebarOpen(false)}
          />
        </aside>
      )}
      {drawerOpen && (
        <div className="fixed inset-0 z-20 md:hidden">
          <button
            aria-label="Close threads"
            className="absolute inset-0 bg-[var(--primitive-backdrop)]"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-border bg-surface-muted">
            <Sidebar
              closeLabel="Close threads"
              onClose={() => setDrawerOpen(false)}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center gap-1 px-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open threads"
            title="Open threads"
            onClick={() => setDrawerOpen(true)}
          >
            <IconLayoutSidebarLeftExpand />
          </Button>
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              aria-label="Open sidebar"
              title="Open sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <IconLayoutSidebarLeftExpand />
            </Button>
          )}
          <span className={cn("contents", sidebarOpen && "md:hidden")}>
            <NewThreadButton />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
            {header}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
