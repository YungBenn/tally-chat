"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";

const input =
  "w-full rounded-lg border border-line bg-card px-3 py-2.5 text-[15px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const status = useQuery(api.owner.setupStatus);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === undefined) return null;
  const setup = status.needsSetup;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (setup && password !== form.get("confirm")) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn("password", { flow: setup ? "signUp" : "signIn", password });
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        setup
          ? /already/.test(message)
            ? "This instance already has an owner"
            : "Could not set the password"
          : "Wrong password",
      );
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="grid size-6 place-items-center rounded-md bg-accent font-mono text-xs text-accent-foreground">
            t
          </span>
          tally.chat
        </div>
        <h1 className="font-serif text-2xl">{setup ? "Set your password" : "Welcome back"}</h1>
        <p className="text-sm text-muted">
          {setup
            ? "This instance has no owner yet. The password you set now protects your provider keys; there is only one account."
            : "Enter the instance password."}
        </p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        {/* Lets password managers save the single account under a name. */}
        <input type="text" name="username" value="owner" autoComplete="username" readOnly hidden />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input
            className={input}
            type="password"
            name="password"
            minLength={8}
            required
            autoFocus
            autoComplete={setup ? "new-password" : "current-password"}
          />
        </label>
        {setup && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Confirm password
            <input className={input} type="password" name="confirm" minLength={8} required autoComplete="new-password" />
            <span className="text-xs font-normal text-muted">At least 8 characters.</span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="mt-1 cursor-pointer rounded-lg bg-accent py-2.5 text-[15px] font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "One moment..." : setup ? "Set password" : "Log in"}
        </button>
      </form>
    </main>
  );
}
