"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navLink = "rounded-lg px-3 py-1.5 text-sm hover:bg-line/60 hover:text-foreground";

export default function AppHeader() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const path = usePathname();

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
        <button className={`${navLink} cursor-pointer`} onClick={() => void signOut().then(() => router.push("/signin"))}>
          Log out
        </button>
      </nav>
    </header>
  );
}
