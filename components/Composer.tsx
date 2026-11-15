"use client";

import {
  IconArrowUp,
  IconPhoto,
  IconPlayerStopFilled,
  IconX,
} from "@tabler/icons-react";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { MAX_IMAGES_PER_MESSAGE, type MessageImage } from "@/convex/lib/images";
import { ACCEPT_ATTRIBUTE, prepareAndUpload } from "@/lib/imageUpload";
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
  canAttach = false,
  onImagesChange,
  attachNote,
  streaming = false,
  disabled = false,
}: {
  onSend: (text: string, images: MessageImage[]) => Promise<unknown>;
  canAttach?: boolean; // the model accepts images (spec phase 4)
  onImagesChange?: (images: MessageImage[]) => void; // the cost strip prices attached images
  attachNote?: string; // a cache note about the attached images
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
  // Attached images: a local preview while uploading, the stored image once ready.
  const [attached, setAttached] = useState<
    { key: number; preview: string; image?: MessageImage }[]
  >([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadUrl = useMutation(api.chat.generateImageUploadUrl);
  const uploading = attached.some((a) => !a.image);
  const ready = attached.flatMap((a) => (a.image ? [a.image] : []));

  const setAttachments = setAttached;
  // Tell the page which images are ready (the cost strip prices them) after each change, never
  // from inside a state update.
  useEffect(() => {
    onImagesChange?.(attached.flatMap((a) => (a.image ? [a.image] : [])));
  }, [attached, onImagesChange]);

  async function attach(files: File[]) {
    if (!canAttach) return;
    const room = MAX_IMAGES_PER_MESSAGE - attached.length;
    if (files.length > room)
      setError(`At most ${MAX_IMAGES_PER_MESSAGE} images per message`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = Math.random();
      const preview = URL.createObjectURL(file);
      setAttached((list) => [...list, { key, preview }]);
      try {
        const image = await prepareAndUpload(file, () => uploadUrl());
        setAttached((list) =>
          list.map((a) => (a.key === key ? { ...a, image } : a)),
        );
      } catch (err) {
        setAttached((list) => list.filter((a) => a.key !== key));
        setError(
          err instanceof Error ? err.message : "Could not attach the image",
        );
      }
    }
  }

  async function submit() {
    if (!text.trim() || streaming || disabled || uploading) return;
    setError(null);
    try {
      await onSend(text, ready);
      setText("");
      onDraftChange?.("");
      attached.forEach((a) => URL.revokeObjectURL(a.preview));
      setAttachments([]);
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
        className={`flex flex-col rounded-[1.5rem] transition-shadow focus-within:ring-2 focus-within:ring-[var(--primitive-ring)] ${dragging ? "ring-2 ring-[var(--primitive-ring)]" : ""}`}
        onDragOver={(e) => {
          if (!canAttach || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!canAttach) return;
          e.preventDefault();
          setDragging(false);
          void attach(
            [...e.dataTransfer.files].filter((f) =>
              f.type.startsWith("image/"),
            ),
          );
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter((f) =>
            f.type.startsWith("image/"),
          );
          if (!canAttach || files.length === 0) return;
          e.preventDefault();
          void attach(files);
        }}
      >
        {attached.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attached.map((a) => (
              <div
                key={a.key}
                className="relative size-16 overflow-hidden rounded-lg border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
                <img
                  src={a.preview}
                  alt=""
                  className={`size-full object-cover ${a.image ? "" : "opacity-50"}`}
                />
                <button
                  type="button"
                  aria-label="Remove image"
                  title="Remove image"
                  className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-background/90 text-foreground [&_svg]:size-3"
                  onClick={() => {
                    URL.revokeObjectURL(a.preview);
                    setAttachments(attached.filter((x) => x.key !== a.key));
                  }}
                >
                  <IconX />
                </button>
              </div>
            ))}
            {attachNote && (
              <p className="basis-full text-xs text-muted-foreground">
                {attachNote}
              </p>
            )}
          </div>
        )}
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
            {canAttach && (
              <>
                <button
                  type="button"
                  className="icon-action"
                  aria-label="Attach images"
                  title="Attach images (or paste or drop them)"
                  onClick={() => fileInput.current?.click()}
                >
                  <IconPhoto />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT_ATTRIBUTE}
                  multiple
                  hidden
                  onChange={(e) => {
                    void attach([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
              </>
            )}
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
              disabled={!text.trim() || disabled || uploading}
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
