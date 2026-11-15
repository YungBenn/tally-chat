"use client";

import { MAX_IMAGE_EDGE, type MessageImage } from "@/convex/lib/images";

const ACCEPTED = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED.join(",");

// Downscales an image in the browser to at most MAX_IMAGE_EDGE on the long edge (the most the
// model reads, so no paying for pixels it can't use) and re-encodes it: JPEG for photos, PNG
// for sources that may carry transparency. Then uploads it to Convex storage.
export async function prepareAndUpload(
  file: File,
  uploadUrl: () => Promise<string>,
): Promise<MessageImage> {
  if (!(ACCEPTED as readonly string[]).includes(file.type))
    throw new Error("Use a JPEG, PNG, GIF or WebP image");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const mediaType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvas.convertToBlob({ type: mediaType, quality: 0.9 });
  const res = await fetch(await uploadUrl(), {
    method: "POST",
    headers: { "Content-Type": mediaType },
    body: blob,
  });
  if (!res.ok) throw new Error("Could not upload the image");
  const { storageId } = (await res.json()) as {
    storageId: MessageImage["storageId"];
  };
  return { storageId, mediaType, width, height };
}
