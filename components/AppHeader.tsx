"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navLink = "rounded-lg px-3 py-1.5 text-sm hover:bg-line/60 hover:text-foreground";

export default function AppHeader() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const path = usePathname();
  const settings = useQuery(api.settings.get);
  const setTimeZone = useMutation(api.settings.setTimeZone);

  // Daily spend uses the owner's day; record the browser's time zone the first time.
  useEffect(() => {
    if (settings && settings.timeZone === null) {
      void setTimeZone({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    }
  }, [settings, setTimeZone]);

  return (
    <header className="flex h-13 items-center justify-between px-4">
      <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="grid size-6 place-items-center rounded-md bg-accent font-mono text-xs text-accent-foreground">
          t
        </span>
        tally.chat
      </Link>
      <nav className="flex items-center gap-1 text-muted">
        <Link href="/providers" className={`${navLink} ${path === "/providers" ? "text-foreground" : ""}`}>
          Providers
        </Link>
        <Link href="/settings" className={`${navLink} ${path === "/settings" ? "text-foreground" : ""}`}>
          Settings
        </Link>
        <button className={`${navLink} cursor-pointer`} onClick={() => void signOut().then(() => router.push("/signin"))}>
          Log out
        </button>
      </nav>
    </header>
  );
}
