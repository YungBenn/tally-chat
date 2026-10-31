import { PersistentTextStreaming, type StreamId } from "@convex-dev/persistent-text-streaming";
import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

// Streamed text lives in the persistent-text-streaming component until the reply
// finishes, then it is copied onto the message. We drive streams from a scheduled
// action, not the component's browser-driven HTTP helper (docs/spike-convex-self-host.md),
// so this is the one place that calls the component's undocumented `lib.addChunk`.
// The package version is pinned exactly in package.json for that reason.
const streaming = new PersistentTextStreaming(components.persistentTextStreaming);

export const createStream = (ctx: MutationCtx) => streaming.createStream(ctx);

export const streamText = async (ctx: QueryCtx, streamId: string) =>
  (await streaming.getStreamBody(ctx, streamId as StreamId)).text;

export const deleteStream = (ctx: MutationCtx, streamId: string) => streaming.deleteStream(ctx, streamId as StreamId);

export const appendChunk = (ctx: ActionCtx | MutationCtx, streamId: string, text: string, final: boolean) =>
  ctx.runMutation(components.persistentTextStreaming.lib.addChunk, { streamId: streamId as StreamId, text, final });
