import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireUser, todayUtc } from "./lib/access";
import { activeLoans, overlaps } from "./lib/loans";
import { enqueueNotification } from "./lib/notify";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOAN_DAYS = 30;

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

function validateRange(start: string, end: string, today: string) {
  if (!DATE.test(start) || !DATE.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new Error("Dates must look like 2026-12-31");
  }
  if (start < today) throw new Error("The start date cannot be in the past");
  if (end < start) throw new Error("The end date must be on or after the start date");
  if (dayNumber(end) - dayNumber(start) + 1 > MAX_LOAN_DAYS) {
    throw new Error(`A loan can be at most ${MAX_LOAN_DAYS} days`);
  }
}

/** Latest automation activity for a loan, shown on each loan in the app. */
async function lastAutomation(ctx: QueryCtx, loanId: Doc<"loans">["_id"]) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .collect();
  const done = events.filter((e) => e.status === "sent" || e.status === "failed");
  if (done.length === 0) return null;
  const latest = done.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));
  return { kind: latest.kind, status: latest.status, at: latest.updatedAt };
}

async function shape(ctx: QueryCtx, loan: Doc<"loans">, today: string, viewer: "borrower" | "lender" | "admin") {
  const out = {
    _id: loan._id,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    createdAt: loan.createdAt,
    overdue: loan.status === "approved" && loan.endDate < today,
    lastAutomation: await lastAutomation(ctx, loan._id),
    borrowerName: undefined as string | undefined,
    lenderName: undefined as string | undefined,
  };
  // Data minimisation: a lender sees who is borrowing; a borrower does not see the lender's identity.
  if (viewer !== "borrower") out.borrowerName = (await ctx.db.get(loan.borrowerId))?.name;
  if (viewer === "admin") out.lenderName = (await ctx.db.get(loan.ownerId))?.name;
  return out;
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    validateRange(startDate, endDate, today);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt) throw new Error("Listing not found");
    if (tool.ownerId === me._id) throw new Error("You cannot borrow your own tool");

    for (const l of await activeLoans(ctx, toolId)) {
      if (overlaps(startDate, endDate, l.startDate, l.endDate)) {
        throw new Error("That tool is already lent out for some of those dates");
      }
    }
    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .collect();
    if (mine.some((l) => l.toolId === toolId && l.status === "requested" && overlaps(startDate, endDate, l.startDate, l.endDate))) {
      throw new Error("You already asked to borrow this tool for those dates");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      status: "requested",
      createdAt: Date.now(),
    });
    await enqueueNotification(ctx, loanId, "requested");
    return loanId;
  },
});

/** Only the lender (tool owner) can approve or decline, and only while the request is open. */
export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approve"), v.literal("decline")) },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Request not found");
    if (loan.ownerId !== me._id) throw new Error("Only the tool's owner can answer this request");
    if (loan.status !== "requested") throw new Error(`This request is already ${loan.status}`);

    if (decision === "approve") {
      for (const l of await activeLoans(ctx, loan.toolId)) {
        if (overlaps(loan.startDate, loan.endDate, l.startDate, l.endDate)) {
          throw new Error("Another approved loan already covers those dates");
        }
      }
      if (loan.endDate < todayUtc()) throw new Error("These dates have already passed");
    }
    await ctx.db.patch(loanId, {
      status: decision === "approve" ? "approved" : "declined",
      decidedAt: Date.now(),
    });
    await enqueueNotification(ctx, loanId, decision === "approve" ? "approved" : "declined");
  },
});

/** The borrower can withdraw their own open request. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Request not found");
    if (loan.borrowerId !== me._id) throw new Error("You can only cancel your own requests");
    if (loan.status !== "requested") throw new Error(`This request is already ${loan.status}`);
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueNotification(ctx, loanId, "withdrawn");
  },
});

/** Only the lender marks a tool as returned. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Loan not found");
    if (loan.ownerId !== me._id) throw new Error("Only the tool's owner can mark it returned");
    if (loan.status !== "approved") throw new Error("Only an approved loan can be marked returned");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueNotification(ctx, loanId, "returned");
  },
});

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .collect();
    return Promise.all(loans.map((l) => shape(ctx, l, today, "borrower")));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return Promise.all(loans.map((l) => shape(ctx, l, today, "lender")));
  },
});

/** Admin only: every loan in the system. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = todayUtc();
    const loans = await ctx.db.query("loans").order("desc").take(500);
    return Promise.all(loans.map((l) => shape(ctx, l, today, "admin")));
  },
});
