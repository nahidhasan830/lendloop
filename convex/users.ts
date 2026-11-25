import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/access";

/** Create or refresh the signed-in user's profile. Role is never read from the client. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const name = (identity.name ?? identity.nickname ?? "Neighbour").slice(0, 80);
    const email = identity.email;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trustedLender: false,
      createdAt: Date.now(),
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/** Admin only: all members, so an admin can pick who to mark as a Trusted Lender. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Bootstrap the first admin from the CLI (not callable from the browser):
 *   npx convex run users:setRoleByEmail '{"email":"you@example.com","role":"admin"}'
 */
export const setRoleByEmail = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("user"), v.literal("admin")) },
  handler: async (ctx, { email, role }) => {
    const users = await ctx.db.query("users").collect();
    const target = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!target) throw new Error("No user with that email has signed in yet");
    await ctx.db.patch(target._id, { role });
    return target._id;
  },
});
