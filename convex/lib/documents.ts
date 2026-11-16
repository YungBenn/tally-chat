import { v, type Infer } from "convex/values";

// Documents, phase 1: a PDF or text file's text, extracted once on attach (documents.extract) and
// sent before the message it came with on every request. Stored text never changes, so the
// message's bytes, and the cache built on them, never do.

// What a user message keeps of each document it sent, fixed at creation.
export const documentRefValidator = v.object({
  id: v.id("documents"),
  name: v.string(),
  tokens: v.number(),
  fromThreadId: v.optional(v.id("threads")), // a mentioned thread, copied when it was mentioned
});
export type DocumentRef = Infer<typeof documentRefValidator>;

// ponytail: the whole text rides along every turn (mostly as cache reads). Past this, a document
// needs chunks and retrieval rather than a bigger cap.
export const MAX_DOCUMENT_TOKENS = 100_000;
export const MAX_DOCUMENTS_PER_MESSAGE = 5;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// The file picker's filter; the server decides by content (a PDF, or text that decodes).
export const DOCUMENT_ACCEPT = [
  "application/pdf",
  "text/*",
  "application/json",
  ...[
    "pdf", "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini",
    "xml", "html", "css", "log", "sql", "sh", "js", "jsx", "ts", "tsx", "py", "go", "rs", "java",
    "kt", "swift", "rb", "php", "c", "h", "cpp", "cs",
  ].map((ext) => `.${ext}`),
].join(",");

// What the model sees before the message text. Changing it changes the bytes of every message
// that sent a document, so treat it like a system prompt.
export const documentBlock = (name: string, text: string) =>
  `<document name=${JSON.stringify(name)}>\n${text}\n</document>`;

// A mentioned thread as document text: who said what on its active branch, the attachments
// named but not repeated. `summary` stands in for the turns a condense covered.
export function threadTranscript(
  title: string,
  startedAt: number,
  turns: { role: "user" | "assistant"; content: string; model?: string; attachments: string[] }[],
  summary?: string,
): string {
  const head = `Conversation from the thread "${title}", started ${new Date(startedAt).toISOString().slice(0, 10)}.`;
  const body = turns.map((t) => {
    const who = t.role === "user" ? "User" : `Assistant${t.model ? ` (${t.model})` : ""}`;
    const att = t.attachments.length ? `\n[attached: ${t.attachments.join(", ")}]` : "";
    return `${who}:${att}\n${t.content}`;
  });
  return [head, ...(summary ? [`Summary of the earlier conversation:\n${summary}`] : []), ...body].join("\n\n");
}
