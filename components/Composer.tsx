"use client";

import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/wensity/button";
import { Textarea } from "@/components/wensity/text-area";

export default function Composer({
  onSend,
  onStop,
  onType,
  onDraftChange,
  footer,
  banner,
  controls,
  streaming = false,
  disabled = false,
}: {
  onSend: (text: string) => Promise<unknown>;
  onStop?: () => void;
  onType?: () => void;
  onDraftChange?: (text: string) => void; // the inspector and cost strip price the draft
  footer?: React.ReactNode; // a line under the box (the cost strip)
  banner?: React.ReactNode; // a notice above the box (the soft budget)
  controls?: React.ReactNode; // send options beside the send button (output mode, effort)
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
      onDraftChange?.("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send";
      // The budget banner above already says this, with the override.
      setError(message === "Daily budget reached" ? null : message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      {banner}
      <div
        data-surface="field"
        className="flex flex-col rounded-[1.5rem] transition-shadow focus-within:ring-2 focus-within:ring-[var(--primitive-ring)]"
      >
        <Textarea
          id="composer"
          aria-label="Message"
          variant="ghost"
          resize="none"
          autoResize
          minRows={1}
          maxRows={10}
          value={text}
          placeholder="Message tally..."
          onChange={(e) => {
            setText(e.target.value);
            onDraftChange?.(e.target.value);
            onType?.();
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void submit();
            }
          }}
          textareaClassName="min-h-0 border-0 bg-transparent px-5 pt-4 pb-1 text-[15px] shadow-none hover:bg-transparent focus:ring-0 focus:ring-offset-0"
        />
        <div className="flex items-center justify-between gap-2 pr-3 pb-3 pl-4">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {controls}
          </div>
          {streaming ? (
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              aria-label="Stop"
              title="Stop"
              onClick={onStop}
            >
              <IconPlayerStopFilled />
            </Button>
          ) : (
            <Button
              size="icon"
              className="rounded-full"
              aria-label="Send"
              title="Send"
              disabled={!text.trim() || disabled}
              onClick={() => void submit()}
            >
              <IconArrowUp />
            </Button>
          )}
        </div>
      </div>
      {footer}
      {error && (
        <p
          role="alert"
          className="mt-2 px-2 text-sm text-primitive-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
