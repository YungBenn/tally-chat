"use client";

import { IconArrowUp, IconFileText, IconPaperclip, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DOCUMENT_ACCEPT, MAX_DOCUMENTS_PER_MESSAGE } from "@/convex/lib/documents";
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
  onDocumentsChange,
  attachNote,
  streaming = false,
  disabled = false,
  paused = false,
  placeholder = "Message tally...",
}: {
  onSend: (text: string, images: MessageImage[], documents: Id<"documents">[]) => Promise<unknown>;
  canAttach?: boolean; // the model accepts images (spec phase 4); documents work with any model
  onImagesChange?: (images: MessageImage[]) => void; // the cost strip prices attached images
  onDocumentsChange?: (tokens: number) => void; // ...and attached documents' text
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
  // Attachments: an image (a local preview while uploading, the stored image once ready) or a
  // document (its extracted text's id and size once read).
  const [attached, setAttached] = useState<
    (
      | { kind: "image"; key: number; name: string; preview: string; image?: MessageImage }
      | { kind: "document"; key: number; name: string; doc?: { id: Id<"documents">; tokens: number } }
    )[]
  >([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const uploadUrl = useMutation(api.chat.generateImageUploadUrl);
  const extract = useAction(api.documentActions.extract);
  const uploading = attached.some((a) => (a.kind === "image" ? !a.image : !a.doc));
  const ready = attached.flatMap((a) => (a.kind === "image" && a.image ? [a.image] : []));
  const readyDocs = attached.flatMap((a) => (a.kind === "document" && a.doc ? [a.doc] : []));
  const off = disabled || paused;
  const attachKbd = useShortcutLabel(SHORTCUTS.attach);

  // Tell the page which images are ready (the cost strip prices them) after each change, never
  // from inside a state update.
  useEffect(() => {
    onImagesChange?.(attached.flatMap((a) => (a.kind === "image" && a.image ? [a.image] : [])));
    onDocumentsChange?.(
      attached.reduce((sum, a) => sum + (a.kind === "document" && a.doc ? a.doc.tokens : 0), 0),
    );
  }, [attached, onImagesChange, onDocumentsChange]);

  // Grow with the text up to the CSS max-height, then scroll.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useShortcut(SHORTCUTS.focusComposer, () => box.current?.focus(), !off);
  useShortcut(SHORTCUTS.attach, () => fileInput.current?.click(), !off);

  async function attachImage(file: File) {
    const key = Math.random();
    const preview = URL.createObjectURL(file);
    setAttached((list) => [...list, { kind: "image", key, name: file.name || "Pasted image", preview }]);
    try {
      const image = await prepareAndUpload(file, () => uploadUrl());
      setAttached((list) => list.map((a) => (a.key === key ? { ...a, image } : a)));
    } catch (err) {
      setAttached((list) => list.filter((a) => a.key !== key));
      setError(err instanceof Error ? err.message : "Could not attach the image");
    }
  }

  // Uploads the file, then the server reads its text once (documents.extract).
  async function attachDocument(file: File) {
    const key = Math.random();
    setAttached((list) => [...list, { kind: "document", key, name: file.name }]);
    try {
      const res = await fetch(await uploadUrl(), { method: "POST", body: file });
      if (!res.ok) throw new Error(`Could not upload ${file.name}`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const doc = await extract({ storageId, name: file.name });
      setAttached((list) =>
        list.map((a) => (a.key === key ? { ...a, doc: { id: doc.documentId, tokens: doc.tokens } } : a)),
      );
    } catch (err) {
      setAttached((list) => list.filter((a) => a.key !== key));
      // A ConvexError says what is wrong with the file; anything else is a server fault.
      setError(err instanceof ConvexError ? String(err.data) : `Could not read ${file.name}`);
    }
  }

  function attach(files: File[]) {
    setError(null);
    let images = attached.filter((a) => a.kind === "image").length;
    let documents = attached.length - images;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        if (!canAttach) setError("This model can't read images");
        else if (images >= MAX_IMAGES_PER_MESSAGE) setError(`At most ${MAX_IMAGES_PER_MESSAGE} images per message`);
        else {
          images++;
          void attachImage(file);
        }
      } else if (documents >= MAX_DOCUMENTS_PER_MESSAGE) {
        setError(`At most ${MAX_DOCUMENTS_PER_MESSAGE} documents per message`);
      } else {
        documents++;
        void attachDocument(file);
      }
    }
  }

  async function submit() {
    if (!text.trim() || streaming || off || uploading) return;
    setError(null);
    try {
      await onSend(text, ready, readyDocs.map((d) => d.id));
      setText("");
      onDraftChange?.("");
      attached.forEach((a) => a.kind === "image" && URL.revokeObjectURL(a.preview));
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
          if (off || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (off) return;
          e.preventDefault();
          setDragging(false);
          attach([...e.dataTransfer.files]);
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (off || files.length === 0) return;
          e.preventDefault();
          attach(files);
        }}
      >
        {attached.length > 0 && (
          <div className="tc-composer-attach flex-wrap">
            {attached.map((a) => (
              <span key={a.key} className="tc-attach tc-pop-in">
                <span className="tc-attach-thumb">
                  {a.kind === "image" && a.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
                    <img src={a.preview} alt="" />
                  ) : a.kind === "document" && a.doc ? (
                    <IconFileText size={16} stroke={1.5} />
                  ) : (
                    <Spinner size={14} label={a.kind === "image" ? "Uploading" : "Reading"} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block max-w-40 truncate">{a.name}</span>
                  <small>
                    {a.kind === "image"
                      ? a.image
                        ? `${a.image.width}×${a.image.height} · ~${tokens(imageTokens(a.image))} tok`
                        : "Uploading…"
                      : a.doc
                        ? `~${tokens(a.doc.tokens)} tok`
                        : "Reading…"}
                  </small>
                </span>
                <IconButton
                  icon={<IconX />}
                  label={`Remove ${a.name}`}
                  size="sm"
                  onClick={() => {
                    if (a.kind === "image") URL.revokeObjectURL(a.preview);
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
          <IconButton
            icon={<IconPaperclip />}
            label={canAttach ? "Attach images or documents (or paste or drop them)" : "Attach documents (or drop them)"}
            kbd={attachKbd}
            size="sm"
            disabled={off}
            onClick={() => fileInput.current?.click()}
          />
          <input
            ref={fileInput}
            type="file"
            accept={canAttach ? `${ACCEPT_ATTRIBUTE},${DOCUMENT_ACCEPT}` : DOCUMENT_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              attach([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <div className="tc-composer-controls">{controls}</div>
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

