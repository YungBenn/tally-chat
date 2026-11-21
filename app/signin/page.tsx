"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { api } from "@/convex/_generated/api";
import { reduced, variants } from "@/lib/motion";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const status = useQuery(api.owner.setupStatus);
  const router = useRouter();
  const [error, setError] = useState<{ field: "password" | "confirm"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLInputElement>(null);
  const enter = useReducedMotion() ? reduced.dialog : variants.dialog;

  if (status === undefined) return <main className="tc-grid-bg min-h-dvh" />;
  const setup = status.needsSetup;

  // Errors fade in under the field in error, which takes focus; nothing shakes.
  const fail = (field: "password" | "confirm", text: string) => {
    setError({ field, text });
    (field === "confirm" ? confirm : password).current?.focus();
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = String(form.get("password"));
    if (setup && value !== form.get("confirm")) return fail("confirm", "Passwords don't match.");
    setLoading(true);
    setError(null);
    // Decided before the try: React Compiler can't compile a ternary inside one.
    const flow = setup ? "signUp" : "signIn";
    try {
      await signIn("password", { flow, password: value });
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setLoading(false);
      fail(
        "password",
        setup
          ? /already/.test(message)
            ? "This instance already has an owner."
            : "Could not set the password."
          : "Wrong password.",
      );
    }
  }

  return (
    <main className="tc-grid-bg flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <motion.div
        variants={enter}
        initial="initial"
        animate="animate"
        className="tc-signin-card holo-border holo-subtle"
      >
        <BrandMark size={40} draw />
        <div className="flex flex-col gap-2">
          <h1 className="text-display">{setup ? "Set your password" : "Welcome back"}</h1>
          <p className="text-body text-foreground-muted">
            {setup
              ? "tally.chat runs on your server. This password unlocks it and protects your provider keys; there is only one account."
              : "Enter your password to open your threads."}
          </p>
        </div>
        <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate={false}>
          {/* Lets password managers save the single account under a name. */}
          <input type="text" name="username" value="owner" autoComplete="username" readOnly hidden />
          <div className="flex flex-col gap-3.5">
            <Input
              ref={password}
              label="Password"
              type="password"
              name="password"
              minLength={8}
              required
              autoFocus
              autoComplete={setup ? "new-password" : "current-password"}
              help={setup ? "At least 8 characters." : undefined}
              error={error?.field === "password" ? error.text : undefined}
              onChange={() => error?.field === "password" && setError(null)}
            />
            {setup && (
              <Input
                ref={confirm}
                label="Confirm password"
                type="password"
                name="confirm"
                minLength={8}
                required
                autoComplete="new-password"
                error={error?.field === "confirm" ? error.text : undefined}
                onChange={() => error?.field === "confirm" && setError(null)}
              />
            )}
          </div>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            {setup ? "Set password" : "Unlock"}
          </Button>
        </form>
      </motion.div>
      <p className="text-caption text-foreground-subtle">Chat with any model. See what every turn costs.</p>
    </main>
  );
}
