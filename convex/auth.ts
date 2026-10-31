import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

// Single-user instance: the owner logs in with a password only, so every
// sign-in uses this fixed account id instead of a user-typed email.
export const OWNER_ACCOUNT = "owner";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ profile: () => ({ email: OWNER_ACCOUNT }) })],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) return args.existingUserId;
      // Setup closes for good once the owner exists, enforced here on the
      // server rather than by hiding the setup form.
      if ((await ctx.db.query("users").first()) !== null) {
        throw new ConvexError("This instance already has an owner");
      }
      return ctx.db.insert("users", { email: OWNER_ACCOUNT });
    },
  },
});
