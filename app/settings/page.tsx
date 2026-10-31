"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/convex/_generated/api";

const input =
  "w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export default function SettingsPage() {
  const settings = useQuery(api.settings.get);
  const addHost = useMutation(api.settings.addAllowedHost);
  const removeHost = useMutation(api.settings.removeAllowedHost);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setError(null);
    try {
      await addHost({ host: String(new FormData(formEl).get("host")) });
      formEl.reset();
    } catch (err) {
      setError(err instanceof ConvexError ? String(err.data) : "Something went wrong");
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
        <h1 className="font-serif text-2xl">Settings</h1>
        <section className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
          <div>
            <h2 className="font-medium">Private host allowlist</h2>
            <p className="mt-1 text-sm text-muted">
              By default this server only calls public https addresses, so a typed URL can&apos;t reach your network.
              Hosts listed here are allowed anyway, over http too. Add only machines you trust, such as Ollama on
              your LAN.
            </p>
          </div>
          {settings && settings.allowlistedHosts.length > 0 && (
            <ul className="flex flex-col">
              {settings.allowlistedHosts.map((host) => (
                <li key={host} className="flex items-center justify-between border-t border-line py-2">
                  <span className="font-mono text-sm">{host}</span>
                  <button
                    className="cursor-pointer rounded-lg px-2.5 py-1 text-sm text-muted hover:bg-line/60 hover:text-danger"
                    onClick={() => void removeHost({ host })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="flex flex-col gap-2" onSubmit={onSubmit}>
            <div className="flex gap-2">
              <input className={input} name="host" placeholder="192.168.1.20:11434" aria-label="Host" required />
              <button className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium whitespace-nowrap text-accent-foreground hover:opacity-90">
                Add host
              </button>
            </div>
            <span className="text-xs text-muted">A host, or host:port to allow only that port.</span>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </section>
      </main>
    </div>
  );
}
