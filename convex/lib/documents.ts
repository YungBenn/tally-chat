import { v, type Infer } from "convex/values";

// Documents, phase 1: a PDF or text file's text, extracted once on attach (documents.extract) and
// sent before the message it came with on every request. Stored text never changes, so the
// message's bytes, and the cache built on them, never do.

// What a user message keeps of each document it sent, fixed at creation.
export const documentRefValidator = v.object({
  id: v.id("documents"),
  name: v.string(),
  tokens: v.number(),
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
