import { defineSchema } from "convex/server";
import { authTables } from "@convex-dev/auth/server";

// Convention: every table the owner creates has `ownerId: v.id("users")`,
// set via `requireOwner` in ./owner.ts, so multi-user later is a feature
// rather than a migration.
export default defineSchema({
  ...authTables,
});
