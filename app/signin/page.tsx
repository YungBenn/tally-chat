"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/wensity/button";
import { Input } from "@/components/wensity/input";
import { api } from "@/convex/_generated/api";

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
        <div className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <span className="grid size-6 place-items-center rounded-md bg-foreground font-mono text-xs text-background">
            t
          </span>
          tally.chat
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">
          {setup ? "Set your password" : "Welcome back"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {setup
            ? "This instance has no owner yet. The password you set now protects your provider keys; there is only one account."
            : "Enter the instance password."}
        </p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        {/* Lets password managers save the single account under a name. */}
        <input
          type="text"
          name="username"
          value="owner"
          autoComplete="username"
          readOnly
          hidden
        />
        <Input
          label="Password"
          type="password"
          name="password"
          minLength={8}
          required
          autoFocus
          autoComplete={setup ? "new-password" : "current-password"}
        />
        {setup && (
          <Input
            label="Confirm password"
            type="password"
            name="confirm"
            minLength={8}
            required
            autoComplete="new-password"
            hint="At least 8 characters."
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-primitive-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-1" loading={loading}>
          {setup ? "Set password" : "Log in"}
        </Button>
      </form>
    </main>
  );
}
