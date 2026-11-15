"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import {
  IconChartBar,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMenu2,
  IconMessagePlus,
  IconPlugConnected,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BrandMark from "@/components/BrandMark";
import BudgetMeter from "@/components/BudgetMeter";
import { Button, IconButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/feedback";
import { Sheet } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useMedia, NARROW } from "@/lib/useMedia";
import { useShortcut, useShortcutLabel } from "@/lib/useShortcut";
import { useStoredFlag } from "@/lib/storedFlag";
import { groupThreads } from "@/lib/threadGroups";
import { cn } from "@/lib/utils";

// The query's terms marked in a snippet (search matches each term as a word prefix).
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-transparent font-medium text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** One thread in the sidebar (design system: ThreadItem). The active one gets a subtle holo edge. */
function ThreadItem({
  href,
  title,
  active,
  onNavigate,
}: {
  href: string;
  title: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : undefined}
      className={cn("tc-thread", active && "holo-border holo-subtle")}
    >
      <span className="tc-thread-title">{title}</span>
    </Link>
  );
}

const NAV = [
  { href: "/usage", label: "Usage", icon: IconChartBar },
  { href: "/providers", label: "Providers", icon: IconPlugConnected },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

function Sidebar({
  close,
  closeLabel,
  closeKbd,
  onNavigate,
  searchRef,
}: {
  close: () => void;
  closeLabel: string;
  closeKbd?: string;
  onNavigate?: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const threads = useQuery(api.chat.listThreads);
  const { threadId } = useParams<{ threadId?: string }>();
  // Search (spec phases 4 and 7): titles, then messages, replacing the grouped list while
  // there's a query. One request per pause in typing, never a subscription (design doc S10).
  const convex = useConvex();
  const [search, setSearch] = useState("");
  const query = search.trim();
  const [found, setFound] = useState<{
    query: string;
    result: FunctionReturnType<typeof api.search.search>;
  } | null>(null);
  useEffect(() => {
    if (!query) return;
    let current = true;
    const timer = setTimeout(() => {
      void convex
        .query(api.search.search, { query })
        .then((result) => current && setFound({ query, result }))
        .catch(() => {});
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [convex, query]);
  // The last answer stays up while the next is on its way, so typing doesn't flash the list.
  const results = query ? found?.result : undefined;
  const groups = query
    ? results?.titles.length
      ? [{ label: "Threads", threads: results.titles }]
      : []
    : groupThreads(threads ?? []);
  const path = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const newThreadKbd = useShortcutLabel(SHORTCUTS.newThread);
  const searchKbd = useShortcutLabel(SHORTCUTS.search);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-header shrink-0 items-center gap-2 pr-2 pl-5">
        <Link href="/" onClick={onNavigate} className="mr-auto rounded-control" aria-label="tally.chat home">
          <BrandMark size={22} wordmark />
        </Link>
        <IconButton
          icon={<IconLayoutSidebarLeftCollapse />}
          label={closeLabel}
          kbd={closeKbd}
          size="sm"
          onClick={close}
        />
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-1 pb-2">
        <Button
          icon={<IconMessagePlus />}
          className="w-full"
          onClick={() => {
            onNavigate?.();
            router.push("/");
          }}
        >
          New thread <Kbd>{newThreadKbd}</Kbd>
        </Button>
        <label className="tc-input tc-search">
          <IconSearch size={14} stroke={1.5} className="shrink-0 text-foreground-subtle" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
            }}
            placeholder="Search"
            aria-label="Search threads and messages"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              className="tc-search-clear"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
            >
              <IconX size={14} stroke={1.5} />
            </button>
          ) : (
            <Kbd>{searchKbd}</Kbd>
          )}
        </label>
      </div>
      <nav aria-label="Threads" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.map((g) => (
          <section key={g.label}>
            <h2 className="tc-sidebar-cap">{g.label}</h2>
            {g.threads.map((t) => (
              <ThreadItem
                key={t._id}
                href={`/t/${t._id}`}
                title={t.title}
                active={t._id === threadId}
                onNavigate={onNavigate}
              />
            ))}
          </section>
        ))}
        {query && results && results.messages.length > 0 && (
          <section>
            <h2 className="tc-sidebar-cap">Messages</h2>
            {results.messages.map((m) => (
              <Link
                key={m.messageId}
                href={`/t/${m.threadId}?m=${m.messageId}`}
                onClick={onNavigate}
                className="tc-hit"
              >
                <span className="flex min-w-0 items-baseline gap-1 text-caption text-foreground-subtle">
                  <span className="truncate">{m.threadTitle}</span>
                  <span className="shrink-0">· {m.role === "user" ? "You" : "Reply"}</span>
                </span>
                <span className="line-clamp-2 text-body-sm text-foreground-muted">
                  <Highlight text={m.snippet} query={query} />
                </span>
              </Link>
            ))}
          </section>
        )}
        {query
          ? results &&
            results.titles.length === 0 &&
            results.messages.length === 0 && <p className="tc-sidebar-note">Nothing matches.</p>
          : threads?.length === 0 && <p className="tc-sidebar-note">No threads yet.</p>}
      </nav>
      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border px-3 pt-2 pb-3">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={path === href ? "page" : undefined}
            className="tc-nav"
          >
            <Icon size={16} stroke={1.5} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          className="tc-nav"
          onClick={() => void signOut().then(() => router.push("/signin"))}
        >
          <IconLogout size={16} stroke={1.5} />
          Log out
        </button>
        <BudgetMeter />
      </div>
    </div>
  );
}

/**
 * The app frame (spec phase 8): sidebar (264, collapsible with ⌘B; a left sheet under 900px) and a
 * main column whose 48px header holds `header`.
 */
export default function ChatShell({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useStoredFlag("tally.sidebarOpen", true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrow = useMedia(NARROW);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const settings = useQuery(api.settings.get);
  const setTimeZone = useMutation(api.settings.setTimeZone);
  const sidebarKbd = useShortcutLabel(SHORTCUTS.toggleSidebar);

  // Daily spend uses the owner's day; record the browser's time zone the first time.
  useEffect(() => {
    if (settings && settings.timeZone === null) {
      void setTimeZone({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    }
  }, [settings, setTimeZone]);

  const toggleSidebar = () => (narrow ? setSheetOpen(!sheetOpen) : setSidebarOpen(!sidebarOpen));
  useShortcut(SHORTCUTS.toggleSidebar, toggleSidebar);
  useShortcut(SHORTCUTS.newThread, () => {
    setSheetOpen(false);
    router.push("/");
  });
  useShortcut(SHORTCUTS.search, () => {
    if (narrow) setSheetOpen(true);
    else setSidebarOpen(true);
    // The input mounts with the sidebar; focus it on the next frame.
    requestAnimationFrame(() => searchRef.current?.focus());
  });

  const showDocked = !narrow && sidebarOpen;
  return (
    <div className="flex h-dvh bg-background">
      {showDocked && (
        <aside className="flex w-sidebar shrink-0 flex-col border-r border-border" aria-label="Sidebar">
          <Sidebar
            close={() => setSidebarOpen(false)}
            closeLabel="Close sidebar"
            closeKbd={sidebarKbd}
            searchRef={searchRef}
          />
        </aside>
      )}
      {narrow && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="left" title="Threads">
          <Sidebar
            close={() => setSheetOpen(false)}
            closeLabel="Close threads"
            onNavigate={() => setSheetOpen(false)}
            searchRef={searchRef}
          />
        </Sheet>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="tc-appbar">
          {narrow ? (
            <IconButton
              icon={<IconMenu2 />}
              label="Open threads"
              size="touch"
              onClick={() => setSheetOpen(true)}
            />
          ) : (
            !sidebarOpen && (
              <IconButton
                icon={<IconLayoutSidebarLeftExpand />}
                label="Open sidebar"
                kbd={sidebarKbd}
                size="sm"
                onClick={() => setSidebarOpen(true)}
              />
            )
          )}
          {header}
        </header>
        {children}
      </main>
    </div>
  );
}
