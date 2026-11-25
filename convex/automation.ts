import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./lib/access";

/** Admin only: recent automation problems, so failed runs are never silent. */
export const recentProblems = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const failed = await ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", "failed")).order("desc").take(20);
    const retrying = await ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", "retrying")).order("desc").take(20);
    return [...failed, ...retrying]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((e) => ({ _id: e._id, kind: e.kind, status: e.status, attempts: e.attempts, detail: e.detail, at: e.updatedAt }));
  },
});

/** Approved loans past their end date, minus those already reminded today. */
export const overdueForReminder = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const approved = await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "approved")).collect();
    const rows = [];
    for (const loan of approved) {
      if (loan.endDate >= today) continue;
      const key = `reminder:${loan._id}:${today}`;
      const done = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (done?.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower) continue;
      const daysOverdue = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${loan.endDate}T00:00:00Z`)) / 86_400_000);
      rows.push({
        loanId: loan._id,
        reminderKey: key,
        toolName: loan.toolName,
        dueDate: loan.endDate,
        daysOverdue,
        borrower: { name: borrower.name, email: borrower.email ?? null },
      });
    }
    return rows;
  },
});

/** Idempotent write-back: the same key can be posted again (a retry) without creating a second record. */
export const recordReminder = internalMutation({
  args: { key: v.string(), status: v.union(v.literal("sent"), v.literal("failed")), detail: v.optional(v.string()) },
  handler: async (ctx, { key, status, detail }) => {
    const m = /^reminder:([a-z0-9]+):(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m) throw new Error("Bad reminder key");
    const loanId = ctx.db.normalizeId("loans", m[1]);
    if (!loanId || !(await ctx.db.get(loanId))) throw new Error("Unknown loan");
    const now = Date.now();
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (existing) {
      if (existing.status === "sent") return { duplicate: true };
      await ctx.db.patch(existing._id, { status, attempts: existing.attempts + 1, detail: detail?.slice(0, 300), updatedAt: now });
      return { duplicate: false };
    }
    await ctx.db.insert("automationEvents", {
      key, kind: "overdue_reminder", loanId, status, attempts: 1, detail: detail?.slice(0, 300), createdAt: now, updatedAt: now,
    });
    return { duplicate: false };
  },
});

/** Called by the n8n error workflow so a failed run shows up in the app. Idempotent per execution. */
export const recordWorkflowFailure = internalMutation({
  args: { executionId: v.string(), workflow: v.string(), message: v.string() },
  handler: async (ctx, { executionId, workflow, message }) => {
    const key = `failure:${executionId}`.slice(0, 100);
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (existing) return { duplicate: true };
    const now = Date.now();
    await ctx.db.insert("automationEvents", {
      key, kind: "workflow_failure", status: "failed", attempts: 1,
      detail: `${workflow}: ${message}`.slice(0, 300), createdAt: now, updatedAt: now,
    });
    return { duplicate: false };
  },
});
