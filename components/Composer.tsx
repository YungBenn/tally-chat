"use client";

import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/wensity/button";
import { Textarea } from "@/components/wensity/text-area";

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
          onChange={(e) => setText(e.target.value)}
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
        <div className="flex justify-end px-3 pb-3">
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
