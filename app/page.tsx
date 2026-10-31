"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";

export default function Home() {
  const { signOut } = useAuthActions();
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-13 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="grid size-6 place-items-center rounded-md bg-accent font-mono text-xs text-accent-foreground">
            t
          </span>
          tally.chat
        </div>
        <button
          className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-line/60 hover:text-foreground"
          onClick={() => void signOut().then(() => router.push("/signin"))}
        >
          Log out
        </button>
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="font-serif text-xl text-muted">No threads yet.</p>
      </main>
    </div>
  );
}
