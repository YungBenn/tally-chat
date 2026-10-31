"use client";

import { useState } from "react";

export default function Composer({
  onSend,
  onStop,
  streaming = false,
  disabled = false,
}: {
  onSend: (text: string) => Promise<unknown>;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!text.trim() || streaming || disabled) return;
    setError(null);
    try {
      await onSend(text);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="rounded-2xl border border-line bg-card p-3 shadow-sm">
        <label className="sr-only" htmlFor="composer">
          Message
        </label>
        <textarea
          id="composer"
          rows={2}
          value={text}
          placeholder="Message tally..."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-48 w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-muted"
        />
        <div className="flex items-center justify-end gap-2">
          {streaming ? (
            <button
              onClick={onStop}
              className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-line/60"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={!text.trim() || disabled}
              aria-label="Send"
              className="grid size-8 cursor-pointer place-items-center rounded-lg bg-accent font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↑
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
