"use node";

import { ConvexError, v } from "convex/values";
import { extractText, getDocumentProxy } from "unpdf";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { estimateTokens } from "./inspector";
import { MAX_DOCUMENT_TOKENS, MAX_UPLOAD_BYTES } from "./lib/documents";
import { requireOwner } from "./owner";

const NOT_A_DOCUMENT = "Attach a PDF or a text file";

// A PDF's text layer, or a file's text when it decodes as UTF-8 without NUL bytes.
async function readText(bytes: Uint8Array, name: string): Promise<string> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") {
    try {
      const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
      return text;
    } catch {
      throw new ConvexError(`Could not read ${name}; it may be encrypted or damaged`);
    }
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ConvexError(NOT_A_DOCUMENT);
  }
  if (text.includes("\u0000")) throw new ConvexError(NOT_A_DOCUMENT);
  return text;
}

// Node runtime: unpdf's PDF parser needs structuredClone with transfer, which the default
// runtime lacks.
// Reads an uploaded file into a document, priced before it is ever sent. The upload itself is
// removed either way: only the text is kept.
export const extract = action({
  args: { storageId: v.id("_storage"), name: v.string() },
  returns: v.object({
    documentId: v.id("documents"),
    name: v.string(),
    tokens: v.number(),
  }),
  handler: async (ctx, { storageId, name: rawName }) => {
    const ownerId = await requireOwner(ctx);
    const name = rawName.trim().slice(0, 200) || "document";
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new ConvexError("The upload is missing; attach the file again");
      if (blob.size > MAX_UPLOAD_BYTES)
        throw new ConvexError(`${name} is over 20 MB`);
      const text = (await readText(new Uint8Array(await blob.arrayBuffer()), name)).trim();
      if (!text)
        throw new ConvexError(`${name} has no text (a scanned PDF needs OCR first)`);
      const tokens = estimateTokens(text);
      if (tokens > MAX_DOCUMENT_TOKENS)
        throw new ConvexError(
          `${name} is about ${Math.round(tokens / 1000)}k tokens; the limit is ${MAX_DOCUMENT_TOKENS / 1000}k`,
        );
      // Same-file call: annotated, or the generated api types turn circular.
      const documentId: Id<"documents"> = await ctx.runMutation(internal.documents.save, { ownerId, name, text, tokens });
      return { documentId, name, tokens };
    } finally {
      await ctx.storage.delete(storageId);
    }
  },
});

