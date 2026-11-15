"use client";

import { IconArrowUp, IconPaperclip, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { useMutation } from "convex/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { api } from "@/convex/_generated/api";
import { MAX_IMAGES_PER_MESSAGE, imageTokens, type MessageImage } from "@/convex/lib/images";
import { tokens } from "@/lib/format";
import { ACCEPT_ATTRIBUTE, prepareAndUpload } from "@/lib/imageUpload";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useShortcut, useShortcutLabel } from "@/lib/useShortcut";
import { cn } from "@/lib/utils";

/**
 * Where the user writes (design system: Composer). Raised at rest; while focused the edge becomes
 * a vivid shimmering holo line. Controls row: attach, `controls` (model, effort, output mode), then
 * Send (holo only with text) or Stop while streaming. Paused by budget: sunken and disabled.
 */
export default function Composer({
  onSend,
  onStop,
  onType,
  onDraftChange,
  onEditLast,
  footer,
  banner,
  controls,
  canAttach = false,
  onImagesChange,
  attachNote,
  streaming = false,
  disabled = false,
  paused = false,
  placeholder = "Message tally...",
}: {
  onSend: (text: string, images: MessageImage[]) => Promise<unknown>;
  canAttach?: boolean; // the model accepts images (spec phase 4)
  onImagesChange?: (images: MessageImage[]) => void; // the cost strip prices attached images
  attachNote?: string; // a cache note about the attached images
  onStop?: () => void;
  onType?: () => void;
  onDraftChange?: (text: string) => void; // the inspector and cost strip price the draft
  onEditLast?: () => void; // ↑ in an empty composer
  footer?: React.ReactNode; // a line under the box (the cost strip)
  banner?: React.ReactNode; // notices above the box (the soft budget, a suggestion)
  controls?: React.ReactNode; // send options after attach (model, effort, output mode)
  streaming?: boolean;
  disabled?: boolean;
  paused?: boolean; // sending paused by the daily budget
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Attached images: a local preview while uploading, the stored image once ready.
  const [attached, setAttached] = useState<
    { key: number; name: string; preview: string; image?: MessageImage }[]
  >([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const uploadUrl = useMutation(api.chat.generateImageUploadUrl);
  const uploading = attached.some((a) => !a.image);
  const ready = attached.flatMap((a) => (a.image ? [a.image] : []));
  const off = disabled || paused;
  const attachKbd = useShortcutLabel(SHORTCUTS.attach);

  // Tell the page which images are ready (the cost strip prices them) after each change, never
  // from inside a state update.
  useEffect(() => {
    onImagesChange?.(attached.flatMap((a) => (a.image ? [a.image] : [])));
  }, [attached, onImagesChange]);

  // Grow with the text up to the CSS max-height, then scroll.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useShortcut(SHORTCUTS.focusComposer, () => box.current?.focus(), !off);
  useShortcut(SHORTCUTS.attach, () => fileInput.current?.click(), canAttach && !off);

  async function attach(files: File[]) {
    if (!canAttach) return;
    const room = MAX_IMAGES_PER_MESSAGE - attached.length;
    if (files.length > room) setError(`At most ${MAX_IMAGES_PER_MESSAGE} images per message`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = Math.random();
      const preview = URL.createObjectURL(file);
      setAttached((list) => [...list, { key, name: file.name || "Pasted image", preview }]);
      try {
        const image = await prepareAndUpload(file, () => uploadUrl());
        setAttached((list) => list.map((a) => (a.key === key ? { ...a, image } : a)));
      } catch (err) {
        setAttached((list) => list.filter((a) => a.key !== key));
        setError(err instanceof Error ? err.message : "Could not attach the image");
      }
    }
  }

  async function submit() {
    if (!text.trim() || streaming || off || uploading) return;
    setError(null);
    try {
      await onSend(text, ready);
      setText("");
      onDraftChange?.("");
      attached.forEach((a) => URL.revokeObjectURL(a.preview));
      setAttached([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send";
      // The budget banner above already says this, with the override.
      setError(message === "Daily budget reached" ? null : message);
    }
  }

  const canSend = !!text.trim() && !off && !uploading;
  return (
    <div className="tc-composer-dock">
      <div className="tc-composer-col">
      {banner}
      <div
        className={cn("tc-composer", focused && !off && "holo-border holo-shimmer holo-vivid")}
        data-focus={focused ? "true" : undefined}
        data-disabled={off ? "true" : undefined}
        data-drag={dragging ? "true" : undefined}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
        }}
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
          void attach([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
          if (!canAttach || files.length === 0) return;
          e.preventDefault();
          void attach(files);
        }}
      >
        {attached.length > 0 && (
          <div className="tc-composer-attach flex-wrap">
            {attached.map((a) => (
              <span key={a.key} className="tc-attach tc-pop-in">
                <span className="tc-attach-thumb">
                  {a.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
                    <img src={a.preview} alt="" />
                  ) : (
                    <Spinner size={14} label="Uploading" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block max-w-40 truncate">{a.name}</span>
                  <small>
                    {a.image
                      ? `${a.image.width}×${a.image.height} · ~${tokens(imageTokens(a.image))} tok`
                      : "Uploading…"}
                  </small>
                </span>
                <IconButton
                  icon={<IconX />}
                  label={`Remove ${a.name}`}
                  size="sm"
                  onClick={() => {
                    URL.revokeObjectURL(a.preview);
                    setAttached((list) => list.filter((x) => x.key !== a.key));
                  }}
                />
              </span>
            ))}
          </div>
        )}
        {attachNote && attached.length > 0 && <p className="tc-composer-note">{attachNote}</p>}
        <textarea
          ref={box}
          id="composer"
          aria-label="Message"
          rows={1}
          className="tc-composer-input"
          value={text}
          disabled={off}
          placeholder={paused ? "Paused by daily budget" : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            onDraftChange?.(e.target.value);
            onType?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape" && streaming) {
              e.preventDefault();
              onStop?.();
            } else if (e.key === "ArrowUp" && !text && onEditLast) {
              e.preventDefault();
              onEditLast();
            }
          }}
        />
        <div className="tc-composer-bar">
          {canAttach && (
            <>
              <IconButton
                icon={<IconPaperclip />}
                label="Attach images (or paste or drop them)"
                kbd={attachKbd}
                size="sm"
                disabled={off}
                onClick={() => fileInput.current?.click()}
              />
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
          <span className="grow" />
          {streaming ? (
            <Button
              variant="secondary"
              iconOnly
              icon={<IconPlayerStopFilled />}
              aria-label="Stop (Esc)"
              title="Stop (Esc)"
              className="tc-send"
              onClick={onStop}
            />
          ) : (
            <Button
              variant="primary"
              iconOnly
              icon={<IconArrowUp />}
              aria-label="Send"
              title="Send (↵)"
              className="tc-send"
              holo={canSend}
              disabled={!canSend}
              onClick={() => void submit()}
            />
          )}
        </div>
      </div>
      {footer}
      {error && (
        <p role="alert" className="tc-fade-in mt-2 px-1 text-body-sm text-danger">
          {error}
        </p>
      )}
      </div>
    </div>
  );
}

