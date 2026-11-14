import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { savedFor } from "./lib/metering";
import { dayIn } from "./lib/rollups";
import { USAGE_FIELDS, type Usage } from "./lib/usage";

// ponytail: one pass over every metered message and side job; fine for a single owner's few
// days of phase 2 data. A larger instance would batch this with scheduled continuations.
const LIMIT = 10_000;

// Phase 3 rollups, run once with `npx convex run migrations:backfillRollupsPhase3`: creates the
// `upkeep` rows from existing keepalive side jobs and fills `savedMicroUsd` from existing
// replies and side jobs. Days use each call's creation time in the owner's current time zone.
// Totals are set, never added, so running it again changes nothing.
export const backfillRollupsPhase3 = internalMutation({
  args: {},
  returns: v.object({ savingsRows: v.number(), upkeepRows: v.number() }),
  handler: async (ctx) => {
    const timeZones = new Map<Id<"users">, string | undefined>();
    for (const s of await ctx.db.query("settings").take(LIMIT)) timeZones.set(s.ownerId, s.timeZone);
    const free = new Map<Id<"providers">, boolean>();
    for (const p of await ctx.db.query("providers").take(LIMIT)) free.set(p._id, p.free === true);

    type Call = { ownerId: Id<"users">; at: number; model: string; providerId?: Id<"providers">; threadId: Id<"threads">; usage: Usage; cost?: number };
    const calls: (Call & { keepalive: boolean })[] = [];
    for (const m of await ctx.db.query("messages").take(LIMIT)) {
      if (m.usage) calls.push({ ...pick(m), model: m.model ?? "", providerId: m.providerId, usage: m.usage, cost: m.costMicroUsd, keepalive: false });
    }
    for (const j of await ctx.db.query("sideJobs").take(LIMIT)) {
      calls.push({ ...pick(j), model: j.model, providerId: j.providerId, usage: j.usage, cost: j.costMicroUsd, keepalive: j.kind === "keepalive" });
    }

    const saved = new Map<string, number>();
    const upkeep = new Map<string, { ownerId: Id<"users">; day: string; key: string; calls: number; unpricedCalls: number; costMicroUsd: number; savedMicroUsd: number } & Usage>();
    for (const c of calls) {
      const day = dayIn(c.at, timeZones.get(c.ownerId));
      const s = savedFor(c.providerId ? free.get(c.providerId) === true : false, c.model, c.usage);
      for (const [dimension, key] of [["model", c.model], ["provider", c.providerId ?? ""], ["thread", c.threadId]]) {
        const id = `${c.ownerId}|${day}|${dimension}|${key}`;
        saved.set(id, (saved.get(id) ?? 0) + s);
      }
      if (!c.keepalive) continue;
      const id = `${c.ownerId}|${day}|${c.threadId}`;
      const row = upkeep.get(id) ?? {
        ownerId: c.ownerId, day, key: c.threadId, calls: 0, unpricedCalls: 0, costMicroUsd: 0, savedMicroUsd: 0,
        ...(Object.fromEntries(USAGE_FIELDS.map((f) => [f, 0])) as Usage),
      };
      for (const f of USAGE_FIELDS) row[f] += c.usage[f];
      row.calls += 1;
      row.unpricedCalls += c.cost === undefined ? 1 : 0;
      row.costMicroUsd += c.cost ?? 0;
      row.savedMicroUsd += s;
      upkeep.set(id, row);
    }

    let savingsRows = 0;
    for (const [id, total] of saved) {
      const [ownerId, day, dimension, key] = id.split("|") as [Id<"users">, string, "model" | "provider" | "thread", string];
      const row = await ctx.db
        .query("dailyUsage")
        .withIndex("by_owner_day_dimension_key", (q) => q.eq("ownerId", ownerId).eq("day", day).eq("dimension", dimension).eq("key", key))
        .unique();
      if (!row) continue; // metered on a different day than the call was created (around midnight)
      await ctx.db.patch("dailyUsage", row._id, { savedMicroUsd: total });
      savingsRows += 1;
    }
    for (const row of upkeep.values()) {
      const existing = await ctx.db
        .query("dailyUsage")
        .withIndex("by_owner_day_dimension_key", (q) =>
          q.eq("ownerId", row.ownerId).eq("day", row.day).eq("dimension", "upkeep").eq("key", row.key),
        )
        .unique();
      if (existing) await ctx.db.patch("dailyUsage", existing._id, row);
      else await ctx.db.insert("dailyUsage", { ...row, dimension: "upkeep" });
    }
    return { savingsRows, upkeepRows: upkeep.size };
  },
});

const pick = (d: Doc<"messages"> | Doc<"sideJobs">) => ({ ownerId: d.ownerId, at: d._creationTime, threadId: d.threadId });
