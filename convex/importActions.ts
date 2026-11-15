import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import {
  NOT_AN_EXPORT,
  parseExport,
  type ImportedMessage,
} from "./lib/importParse";

// Actions stop at 10 minutes; leave well before and continue in a fresh one.
const TIME_BUDGET_MS = 4 * 60_000;
// One writeChunk call: few enough messages and characters to stay inside mutation limits.
const CHUNK_MESSAGES = 400;
const CHUNK_CHARS = 2_000_000;

// Parses the uploaded export and writes conversations from index `from` on, one by one (long
// ones in chunks). Before the time budget runs out it schedules itself to continue where it got.
// ponytail: each continuation parses the whole file again; fine for exports of a few hundred MB.
export const run = internalAction({
  args: { importId: v.id("imports"), from: v.number() },
  returns: v.null(),
  handler: async (ctx, { importId, from }) => {
    const startedAt = Date.now();
    const job = await ctx.runQuery(internal.imports.get, { importId });
    if (!job?.storageId || job.status === "done" || job.status === "failed")
      return null;
    const blob = await ctx.storage.get(job.storageId);
    if (!blob) {
      await ctx.runMutation(internal.imports.finish, {
        importId,
        error: "The uploaded file is gone",
      });
      return null;
    }
    let parsed: ReturnType<typeof parseExport>;
    try {
      parsed = parseExport(JSON.parse(await blob.text()));
    } catch {
      await ctx.runMutation(internal.imports.finish, {
        importId,
        error: NOT_AN_EXPORT,
      });
      return null;
    }
    if (from === 0)
      await ctx.runMutation(internal.imports.begin, {
        importId,
        source: parsed.source,
        total: parsed.conversations.length,
      });

    for (let i = from; i < parsed.conversations.length; i++) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        await ctx.scheduler.runAfter(0, internal.importActions.run, {
          importId,
          from: i,
        });
        return null;
      }
      const c = parsed.conversations[i];
      // Export ids become short keys that are always valid Convex record keys.
      const key = new Map(c.messages.map((m, j) => [m.key, `k${j}`]));
      const messages: ImportedMessage[] = c.messages.map((m) => ({
        ...m,
        key: key.get(m.key)!,
        parentKey: m.parentKey === undefined ? undefined : key.get(m.parentKey),
      }));
      const ids = new Map<string, Id<"messages">>();
      let threadId: Id<"threads"> | undefined;
      let at = 0;
      do {
        let end = at;
        let chars = 0;
        while (
          end < messages.length &&
          end - at < CHUNK_MESSAGES &&
          (end === at || chars + messages[end].content.length <= CHUNK_CHARS)
        ) {
          chars += messages[end].content.length;
          end++;
        }
        const chunk = messages.slice(at, end);
        const parents = Object.fromEntries(
          chunk.flatMap((m) =>
            m.parentKey && ids.has(m.parentKey)
              ? [[m.parentKey, ids.get(m.parentKey)!]]
              : [],
          ),
        );
        const last = end >= messages.length;
        const activeKey =
          c.activeKey === undefined ? undefined : key.get(c.activeKey);
        if (last && activeKey && ids.has(activeKey))
          parents[activeKey] = ids.get(activeKey)!;
        const result = await ctx.runMutation(internal.imports.writeChunk, {
          importId,
          conversation: {
            externalId: c.externalId,
            title: c.title,
            startedAt: c.startedAt,
          },
          threadId,
          messages: chunk,
          parents,
          activeKey,
          last,
        });
        if (result.skipped) break;
        threadId = result.threadId;
        for (const [k, id] of Object.entries(result.ids)) ids.set(k, id);
        at = end;
      } while (at < messages.length);
    }
    await ctx.runMutation(internal.imports.finish, { importId });
    return null;
  },
});
