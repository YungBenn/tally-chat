import type { Id } from "@/convex/_generated/dataModel";

/**
 * Posts a file to a Convex storage upload URL and returns its storage id. Kept out of components
 * because React Compiler can't compile a `throw` inside their try blocks.
 */
export async function uploadFile(url: string, file: File, error: string, contentType = file.type) {
  const res = await fetch(url, {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : undefined,
    body: file,
  });
  if (!res.ok) throw new Error(error);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}
