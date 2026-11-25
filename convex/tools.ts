import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { category, condition } from "./schema";
import { requireUser, todayUtc } from "./lib/access";
import { isOnLoan } from "./lib/loans";
import { enqueueNotification } from "./lib/notify";

const clean = (s: string, max: number, label: string) => {
  const t = s.trim();
  if (!t) throw new Error(`${label} is required`);
  if (t.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return t;
};

/**
 * PUBLIC: no auth. Data minimisation: name, category and availability only.
 * No owner, no description, no ids that point at people.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const out = [];
    for (const t of tools) {
      if (t.removedAt) continue;
      out.push({
        _id: t._id,
        name: t.name,
        category: t.category,
        available: !(await isOnLoan(ctx, t._id, today)),
      });
    }
    return out;
  },
});

/** Signed-in members: full tool details, still no owner identity beyond a trust badge. */
export const listForMembers = query({
  args: { category: v.optional(category) },
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const out = [];
    for (const t of tools) {
      if (t.removedAt) continue;
      const owner = await ctx.db.get(t.ownerId);
      out.push({
        _id: t._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        available: !(await isOnLoan(ctx, t._id, today)),
        isMine: t.ownerId === me._id,
        trustedLender: owner?.trustedLender ?? false,
      });
    }
    return out;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    const out = [];
    for (const t of tools) {
      if (t.removedAt) continue;
      out.push({
        _id: t._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        available: !(await isOnLoan(ctx, t._id, today)),
      });
    }
    return out;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category,
    condition,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name: clean(args.name, 80, "Name"),
      category: args.category,
      condition: args.condition,
      description: clean(args.description, 500, "Description"),
      createdAt: Date.now(),
    });
  },
});

/** Only the owner may edit. Admins moderate (remove) but do not rewrite other people's listings. */
export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...fields }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt) throw new Error("Listing not found");
    if (tool.ownerId !== me._id) throw new Error("You can only edit your own listings");
    await ctx.db.patch(toolId, {
      name: clean(fields.name, 80, "Name"),
      category: fields.category,
      condition: fields.condition,
      description: clean(fields.description, 500, "Description"),
    });
  },
});

/**
 * Owner can remove their own listing; an admin can remove any listing.
 * Open requests are cancelled. An approved loan stays in history and can still be marked returned.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt) throw new Error("Listing not found");
    if (tool.ownerId !== me._id && me.role !== "admin") {
      throw new Error("You can only delete your own listings");
    }
    const now = Date.now();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    for (const loan of loans) {
      if (loan.status === "requested") {
        await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: now });
        await enqueueNotification(ctx, loan._id, "listing_removed");
      }
    }
    await ctx.db.patch(toolId, { removedAt: now, removedBy: me._id });
  },
});
