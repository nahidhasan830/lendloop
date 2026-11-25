import { internalMutation } from "./_generated/server";
import { enqueueNotification } from "./lib/notify";

/**
 * Demo data for local runs (not callable from the browser):
 *   npx convex run seed:demo
 * Creates two members, a tool, one approved loan that is already overdue, and a fresh request
 * (which sends a notification through n8n). Safe to run twice: it does nothing if data exists.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.db.query("users").first()) !== null) return "already seeded";
    const now = Date.now();
    const day = (o: number) => new Date(now + o * 86_400_000).toISOString().slice(0, 10);
    const lender = await ctx.db.insert("users", { tokenIdentifier: "seed|lender", name: "Lena Lender", email: "lena@example.com", role: "user", trustedLender: true, createdAt: now });
    const borrower = await ctx.db.insert("users", { tokenIdentifier: "seed|borrower", name: "Ben Borrower", email: "ben@example.com", role: "user", trustedLender: false, createdAt: now });
    const drill = await ctx.db.insert("tools", { ownerId: lender, name: "Cordless drill", category: "power tools", condition: "good", description: "18V, two batteries", createdAt: now });
    const ladder = await ctx.db.insert("tools", { ownerId: lender, name: "Folding ladder", category: "hand tools", condition: "like new", description: "3 metres", createdAt: now });
    await ctx.db.insert("loans", { toolId: drill, toolName: "Cordless drill", ownerId: lender, borrowerId: borrower, startDate: day(-10), endDate: day(-3), status: "approved", createdAt: now - 11 * 86_400_000, decidedAt: now - 10 * 86_400_000 });
    const req = await ctx.db.insert("loans", { toolId: ladder, toolName: "Folding ladder", ownerId: lender, borrowerId: borrower, startDate: day(1), endDate: day(2), status: "requested", createdAt: now });
    await enqueueNotification(ctx, req, "requested");
    return "seeded";
  },
});
