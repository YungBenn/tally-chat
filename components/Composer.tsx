"use client";

import { IconArrowUp, IconFileText, IconMessages, IconPaperclip, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { useAction, useMutation, useQuery } from "convex/react";
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
import type { SentAttachments } from "@/lib/optimisticSend";
import { uploadFile } from "@/lib/uploadFile";
import { useShortcut, useShortcutLabel } from "@/lib/useShortcut";
import { cn } from "@/lib/utils";

// Dragged from the sidebar onto the composer to mention a thread: {"id", "title"}.
export const THREAD_DRAG_TYPE = "application/x-tally-thread";

// "@query" right before the caret, at the start or after whitespace: a thread mention being typed.
function mentionAt(value: string, caret: number) {
  const m = /(?:^|\s)@([^@\n]{0,40})$/.exec(value.slice(0, caret));
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null;
}

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
  threadId,
  streaming = false,
  disabled = false,
  paused = false,
  placeholder = "Message tally...",
}: {
  // `shown`: the attachments as the composer showed them, for an optimistic message.
  onSend: (text: string, images: MessageImage[], documents: Id<"documents">[], shown: SentAttachments) => Promise<unknown>;
  canAttach?: boolean; // the model accepts images (spec phase 4); documents work with any model
  onImagesChange?: (images: MessageImage[]) => void; // the cost strip prices attached images
  onDocumentsChange?: (tokens: number) => void; // ...and attached documents' text
  attachNote?: string; // a cache note about the attached images
  threadId?: Id<"threads">; // the open thread, which can't mention itself
  onStop?: () => void;
  onType?: () => void;
  onDraftChange?: (text: string) => void; // the settled draft, which the inspector and cost strip price
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
      | {
          kind: "document";
          key: number;
          name: string;
          thread?: Id<"threads">; // a mentioned thread rather than a file
          doc?: { id: Id<"documents">; tokens: number };
        }
    )[]
  >([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const lastKey = useRef(0); // attachment keys
  const uploadUrl = useMutation(api.chat.generateImageUploadUrl);
  const extract = useAction(api.documentActions.extract);
  const fromThread = useMutation(api.documents.fromThread);
  const threads = useQuery(api.chat.listThreads);
  // The @ thread picker: open while "@query" sits before the caret and some title matches.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [pick, setPick] = useState(0);
  const matches =
    mention && threads
      ? threads
          .filter((t) => t._id !== threadId && t.title.toLowerCase().includes(mention.query.trim().toLowerCase()))
          .slice(0, 6)
      : [];
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

  // The draft lives here; the page hears it only once typing settles, so a keystroke re-renders
  // the composer alone (the cost strip and inspector price the settled draft).
  useEffect(() => {
    const timer = setTimeout(() => onDraftChange?.(text), 200);
    return () => clearTimeout(timer);
  }, [text, onDraftChange]);

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
    const key = ++lastKey.current;
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
    const key = ++lastKey.current;
    setAttached((list) => [...list, { kind: "document", key, name: file.name }]);
    try {
      const storageId = await uploadFile(await uploadUrl(), file, `Could not upload ${file.name}`);
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

  // Copies the thread's branch into a document now (documents.fromThread), priced like a file.
  async function mentionThread(id: Id<"threads">, title: string) {
    setError(null);
    if (id === threadId) return setError("A thread can't mention itself");
    if (attached.some((a) => a.kind === "document" && a.thread === id)) return;
    if (attached.filter((a) => a.kind === "document").length >= MAX_DOCUMENTS_PER_MESSAGE)
      return setError(`At most ${MAX_DOCUMENTS_PER_MESSAGE} documents per message`);
    const key = ++lastKey.current;
    setAttached((list) => [...list, { kind: "document", key, name: title, thread: id }]);
    try {
      const doc = await fromThread({ threadId: id });
      setAttached((list) =>
        list.map((a) => (a.key === key ? { ...a, doc: { id: doc.documentId, tokens: doc.tokens } } : a)),
      );
    } catch (err) {
      setAttached((list) => list.filter((a) => a.key !== key));
      setError(err instanceof ConvexError ? String(err.data) : `Could not mention ${title}`);
    }
  }

  // Replaces the typed "@query" with nothing and mentions the chosen thread.
  function chooseMention(t: { _id: Id<"threads">; title: string }) {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const next = text.slice(0, mention.start) + text.slice(end);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => box.current?.setSelectionRange(mention.start, mention.start));
    void mentionThread(t._id, t.title);
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
    // Clear at once (the page shows the message optimistically); a failed send puts it all back.
    const sent = { text, attached };
    const shown: SentAttachments = {
      images: attached.flatMap((a) => (a.kind === "image" && a.image ? [a.preview] : [])),
      documents: attached.flatMap((a) => (a.kind === "document" && a.doc ? [{ name: a.name, tokens: a.doc.tokens, fromThreadId: a.thread }] : [])),
    };
    setText("");
    setAttached([]);
    try {
      await onSend(text, ready, readyDocs.map((d) => d.id), shown);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send";
      // Anything typed meanwhile stays, after the restored text.
      setText((now) => (now ? `${sent.text}\n\n${now}` : sent.text));
      setAttached((now) => [...sent.attached, ...now]);
      // The budget banner above already says this, with the override.
      setError(message === "Daily budget reached" ? null : message);
      return;
    }
    sent.attached.forEach((a) => a.kind === "image" && URL.revokeObjectURL(a.preview));
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
          const types = e.dataTransfer.types;
          if (off || !(types.includes("Files") || types.includes(THREAD_DRAG_TYPE))) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (off) return;
          e.preventDefault();
          setDragging(false);
          const thread = e.dataTransfer.getData(THREAD_DRAG_TYPE);
          if (thread) {
            const { id, title } = JSON.parse(thread) as { id: Id<"threads">; title: string };
            void mentionThread(id, title);
          } else attach([...e.dataTransfer.files]);
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
                    a.thread ? <IconMessages size={16} stroke={1.5} /> : <IconFileText size={16} stroke={1.5} />
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
        {matches.length > 0 && (
          <div id="mention-list" role="listbox" aria-label="Mention a thread" className="tc-float tc-menu tc-mention tc-pop">
            {matches.map((t, i) => (
              <div
                key={t._id}
                id={`mention-${i}`}
                role="option"
                aria-selected={i === Math.min(pick, matches.length - 1)}
                data-highlighted={i === Math.min(pick, matches.length - 1) ? "true" : undefined}
                className="tc-menu-item"
                // mousedown, not click: keep the caret in the box.
                onMouseDown={(e) => {
                  e.preventDefault();
                  chooseMention(t);
                }}
                onMouseEnter={() => setPick(i)}
              >
                <IconMessages size={16} stroke={1.5} className="shrink-0 text-foreground-subtle" />
                <span className="tc-menu-text truncate">{t.title}</span>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={box}
          id="composer"
          aria-label="Message"
          rows={1}
          className="tc-composer-input"
          value={text}
          disabled={off}
          autoComplete="off" // Firefox restores `disabled` on reload otherwise, breaking hydration
          placeholder={paused ? "Paused by daily budget" : placeholder}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={matches.length > 0 ? "mention-list" : undefined}
          aria-activedescendant={matches.length > 0 ? `mention-${Math.min(pick, matches.length - 1)}` : undefined}
          aria-autocomplete="list"
          onBlur={() => setMention(null)}
          onChange={(e) => {
            const next = mentionAt(e.target.value, e.target.selectionStart);
            if (next?.query !== mention?.query) setPick(0);
            setMention(next);
            setText(e.target.value);
            onType?.();
          }}
          onKeyDown={(e) => {
            if (matches.length > 0) {
              const current = Math.min(pick, matches.length - 1);
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((current + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
                e.preventDefault();
                chooseMention(matches[current]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
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

