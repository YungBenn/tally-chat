import { v, type Infer } from "convex/values";

// An image sent with a user message (spec phase 4): stored in Convex file storage, already
// downscaled in the browser to at most MAX_IMAGE_EDGE on the long edge.
export const imageValidator = v.object({
  storageId: v.id("_storage"),
  mediaType: v.union(
    v.literal("image/jpeg"),
    v.literal("image/png"),
    v.literal("image/gif"),
    v.literal("image/webp"),
  ),
  width: v.number(),
  height: v.number(),
});
export type MessageImage = Infer<typeof imageValidator>;

export const MAX_IMAGE_EDGE = 2576; // the high-resolution tier's long-edge limit
export const MAX_IMAGES_PER_MESSAGE = 8;
