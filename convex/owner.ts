import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Every owned table carries `ownerId: v.id("users")`, always set from this,
// never from a client argument. Call it first in every function except
// `setupStatus` and the auth endpoints.
export async function requireOwner(
  ctx: Pick<QueryCtx, "auth">,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("Not logged in");
  return userId;
}

// Public on purpose: the login page needs to know whether to show setup.
export const setupStatus = query({
  args: {},
  returns: v.object({ needsSetup: v.boolean() }),
  handler: async (ctx) => ({
    needsSetup: (await ctx.db.query("users").first()) === null,
  }),
});

export const me = query({
  args: {},
  returns: v.object({ ownerId: v.id("users") }),
  handler: async (ctx) => ({ ownerId: await requireOwner(ctx) }),
});
