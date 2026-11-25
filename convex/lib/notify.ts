import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export type LoanEvent =
  | "requested" // -> lender
  | "withdrawn" // borrower cancelled -> lender
  | "approved" // -> borrower
  | "declined" // -> borrower
  | "returned" // -> borrower
  | "listing_removed"; // open request cancelled because the listing was removed -> borrower

/**
 * Record a pending notification and schedule its delivery to n8n.
 * The key is unique per loan and event, so enqueuing twice is a no-op.
 */
export async function enqueueNotification(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  event: LoanEvent,
) {
  const key = `status:${loanId}:${event}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing) return;
  const now = Date.now();
  const eventId = await ctx.db.insert("automationEvents", {
    key,
    kind: "status_notification",
    loanId,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
}
