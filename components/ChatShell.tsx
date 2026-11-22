"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import {
  IconChartBar,
  IconDots,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMenu2,
  IconMessagePlus,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconPlugConnected,
  IconTool,
  IconSearch,
  IconSettings,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useQuery as useCachedQuery } from "convex-helpers/react/cache/hooks";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useMemo, useRef, useState } from "react";
import BrandMark from "@/components/BrandMark";
import BudgetMeter from "@/components/BudgetMeter";
import SettingsDialog from "@/components/SettingsDialog";
import { THREAD_DRAG_TYPE } from "@/components/Composer";
import { Button, IconButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/feedback";
import { ChangeToolsDialog } from "@/components/ChangeToolsDialog";
import { Dialog, Menu, MenuItem, MenuSeparator, Sheet } from "@/components/ui/overlay";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useMedia, NARROW } from "@/lib/useMedia";
import { useShortcut, useShortcutLabel } from "@/lib/useShortcut";
import { useStoredFlag } from "@/lib/storedFlag";
import { useThreadCache } from "@/lib/useCacheState";
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

/**
 * One thread in the sidebar (design system: ThreadItem). The active one gets a subtle holo edge.
 * Its menu (the ⋯ button, or a right-click) pins, renames (in place) or deletes it.
 */
// Subscribes to the thread page's queries through the query cache (kept 30 minutes, see the
// (app) layout), so a hovered thread is loaded by the time it's clicked. Subscriptions only:
// presence, and so keepalive, stays with the open thread page (usePresence).
function PrefetchThread({ threadId }: { threadId: Id<"threads"> }) {
  useCachedQuery(api.chat.getThread, { threadId });
  useCachedQuery(api.inspector.get, { threadId });
  useCachedQuery(api.providers.list);
  useThreadCache(threadId);
  return null;
}

function ThreadItem({
  id,
  title,
  pinned,
  tools,
  active,
  onNavigate,
  onHover,
}: {
  id: Id<"threads">;
  title: string;
  pinned: boolean;
  tools?: boolean; // the thread's model can call tools
  active: boolean;
  onNavigate?: () => void;
  onHover: (id: Id<"threads">) => void;
}) {
  const router = useRouter();
  const rename = useMutation(api.chat.renameThread);
  const setPinned = useMutation(api.chat.setThreadPinned);
  const deleteThread = useMutation(api.chat.deleteThread);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changingTools, setChangingTools] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fail = (title: string) => (err: unknown) =>
    toast({ title, body: err instanceof ConvexError ? String(err.data) : undefined, tone: "danger" });

  const save = (value: string) => {
    setEditing(false);
    const name = value.replace(/\s+/g, " ").trim();
    if (name && name !== title)
      void rename({ threadId: id, title: name }).catch(fail("Could not rename the thread"));
  };

  return (
    <div
      data-active={active ? "true" : undefined}
      data-editing={editing ? "true" : undefined}
      className={cn("tc-thread", active && "holo-border holo-subtle")}
      // Right-click opens the same menu as the ⋯ button.
      onContextMenu={(e) => {
        if (editing) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      {editing ? (
        <input
          className="tc-thread-input"
          aria-label="Thread name"
          defaultValue={title}
          maxLength={200}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => save(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
      ) : (
        <Link
          href={`/t/${id}`}
          onClick={onNavigate}
          onMouseEnter={() => onHover(id)}
          onFocus={() => onHover(id)}
          aria-current={active ? "page" : undefined}
          className="tc-thread-link"
          // Dropped on the composer, it mentions this thread.
          onDragStart={(e) => {
            e.dataTransfer.setData(THREAD_DRAG_TYPE, JSON.stringify({ id, title }));
            e.dataTransfer.effectAllowed = "copyLink";
          }}
        >
          <span className="tc-thread-title">{title}</span>
        </Link>
      )}
      {!editing && (
        <Menu
          align="end"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={
            <IconButton
              icon={<IconDots />}
              label="Thread actions"
              size="sm"
              className="tc-thread-menu"
            />
          }
        >
          <MenuItem
            icon={pinned ? <IconPinnedOff size={16} stroke={1.5} /> : <IconPin size={16} stroke={1.5} />}
            onClick={() =>
              void setPinned({ threadId: id, pinned: !pinned }).catch(fail("Could not pin the thread"))
            }
          >
            {pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem icon={<IconPencil size={16} stroke={1.5} />} onClick={() => setEditing(true)}>
            Rename
          </MenuItem>
          {tools && (
            <MenuItem icon={<IconTool size={16} stroke={1.5} />} onClick={() => setChangingTools(true)}>
              Change tools
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem danger icon={<IconTrash size={16} stroke={1.5} />} onClick={() => setConfirmDelete(true)}>
            Delete
          </MenuItem>
        </Menu>
      )}
      {changingTools && <ChangeToolsDialog threadId={id} onClose={() => setChangingTools(false)} />}
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        icon={<IconTrash size={18} stroke={1.5} />}
        title="Delete this thread?"
        description="Its messages are removed for good. Your spend history keeps its cost."
        actions={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                // Leave first, so the open thread's page never queries a thread that no longer exists.
                if (active) router.push("/");
                void deleteThread({ threadId: id }).catch(fail("Could not delete the thread"));
              }}
            >
              Delete thread
            </Button>
          </>
        }
      />
    </div>
  );
}

const NAV = [
  { href: "/usage", label: "Usage", icon: IconChartBar },
  { href: "/providers", label: "Providers", icon: IconPlugConnected },
  { href: "/tools", label: "Tools", icon: IconTool },
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
  // The last thread hovered or focused in the list; the cache keeps earlier ones after it moves on.
  const [hovered, setHovered] = useState<Id<"threads"> | null>(null);
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
  const pinned = threads?.filter((t) => t.pinned) ?? [];
  const groups = query
    ? results?.titles.length
      ? [{ label: "Threads", threads: results.titles }]
      : []
    : [
        ...(pinned.length ? [{ label: "Pinned", threads: pinned }] : []),
        ...groupThreads(threads?.filter((t) => !t.pinned) ?? []),
      ];
  const path = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const newThreadKbd = useShortcutLabel(SHORTCUTS.newThread);
  const searchKbd = useShortcutLabel(SHORTCUTS.search);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="mr-auto rounded-control"
          aria-label="tally.chat home"
        >
          <BrandMark size={28} wordmark />
        </Link>
        <IconButton
          icon={<IconLayoutSidebarLeftCollapse />}
          label={closeLabel}
          kbd={closeKbd}
          onClick={close}
        />
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
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
          <IconSearch
            size={16}
            stroke={1.5}
            className="shrink-0 text-foreground-subtle"
          />
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
          <section
            key={g.label}
            className={cn(g.label === "Pinned" && !query && "tc-sidebar-pinned")}
          >
            <h2 className="tc-sidebar-cap">{g.label}</h2>
            {g.threads.map((t) => (
              <ThreadItem
                key={t._id}
                id={t._id}
                title={t.title}
                pinned={t.pinned}
                tools={(t as { tools?: boolean }).tools}
                active={t._id === threadId}
                onNavigate={onNavigate}
                onHover={setHovered}
              />
            ))}
          </section>
        ))}
        {hovered && <PrefetchThread threadId={hovered} />}
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
                  <span className="shrink-0">
                    · {m.role === "user" ? "You" : "Reply"}
                  </span>
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
            results.messages.length === 0 && (
              <p className="tc-sidebar-note">Nothing matches.</p>
            )
          : threads?.length === 0 && (
              <p className="tc-sidebar-note">No threads yet.</p>
            )}
      </nav>
      <div className="flex shrink-0 flex-col border-t border-border px-1.5 pt-1.5 pb-2">
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
        {/* Settings open as a dialog over the current page (SettingsDialog). */}
        <a href="#settings" onClick={onNavigate} className="tc-nav">
          <IconSettings size={16} stroke={1.5} />
          Settings
        </a>
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

// What a page's app bar needs from the shell: how to bring the sidebar back.
const ShellContext = createContext<{
  narrow: boolean;
  sidebarOpen: boolean;
  openSidebar: () => void;
  openSheet: () => void;
  sidebarKbd: string;
}>({ narrow: false, sidebarOpen: true, openSidebar: () => {}, openSheet: () => {}, sidebarKbd: "" });

/**
 * The app frame (spec phase 8): sidebar (264, collapsible with ⌘B; a left sheet under 900px) and a
 * main column. It is the shared layout of every page that shows the sidebar (app/(app)/layout.tsx),
 * so the sidebar stays mounted, with its state, while pages change under it (spec phase 12).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useStoredFlag(
    "tally.sidebarOpen",
    true,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrow = useMedia(NARROW);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const path = usePathname();
  const settings = useQuery(api.settings.get);
  const setTimeZone = useMutation(api.settings.setTimeZone);
  const sidebarKbd = useShortcutLabel(SHORTCUTS.toggleSidebar);

  // Daily spend uses the owner's day; record the browser's time zone the first time.
  useEffect(() => {
    if (settings && settings.timeZone === null) {
      void setTimeZone({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    }
  }, [settings, setTimeZone]);

  const toggleSidebar = () =>
    narrow ? setSheetOpen(!sheetOpen) : setSidebarOpen(!sidebarOpen);
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

  // Explicit: React Compiler may not keep this literal stable, and a new value re-renders the page's app bar.
  const shell = useMemo(
    () => ({
      narrow,
      sidebarOpen,
      openSidebar: () => setSidebarOpen(true),
      openSheet: () => setSheetOpen(true),
      sidebarKbd,
    }),
    [narrow, sidebarOpen, setSidebarOpen, sidebarKbd],
  );

  const showDocked = !narrow && sidebarOpen;
  return (
    <div className="flex h-dvh bg-background">
      {showDocked && (
        <aside
          className="flex w-sidebar shrink-0 flex-col border-r border-border"
          aria-label="Sidebar"
        >
          <Sidebar
            close={() => setSidebarOpen(false)}
            closeLabel="Close sidebar"
            closeKbd={sidebarKbd}
            searchRef={searchRef}
          />
        </aside>
      )}
      {narrow && (
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          side="left"
          title="Threads"
        >
          <Sidebar
            close={() => setSheetOpen(false)}
            closeLabel="Close threads"
            onNavigate={() => setSheetOpen(false)}
            searchRef={searchRef}
          />
        </Sheet>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <ShellContext value={shell}>{children}</ShellContext>
      </main>
      {/* It follows the hash, which client navigation changes without a hashchange: re-read it per page. */}
      <SettingsDialog key={path} />
    </div>
  );
}

/**
 * A page inside the app frame: its 48px app bar holds `header`, plus the button that brings the
 * sidebar back while it is closed or a sheet.
 */
export default function ChatShell({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { narrow, sidebarOpen, openSidebar, openSheet, sidebarKbd } = use(ShellContext);
  return (
    <>
      {(header || narrow || !sidebarOpen) && (
        <header className="tc-appbar">
          {narrow ? (
            <IconButton
              icon={<IconMenu2 />}
              label="Open threads"
              size="touch"
              onClick={openSheet}
            />
          ) : (
            !sidebarOpen && (
              <IconButton
                icon={<IconLayoutSidebarLeftExpand />}
                label="Open sidebar"
                kbd={sidebarKbd}
                onClick={openSidebar}
              />
            )
          )}
          {header}
        </header>
      )}
      {children}
    </>
  );
}
