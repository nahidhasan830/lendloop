import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;

/** Approved, not yet returned loans of a tool. */
export async function activeLoans(ctx: QueryCtx, toolId: Id<"tools">) {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.filter((l) => l.status === "approved");
}

/** A tool is "on loan" while an approved loan has started and is not returned (overdue included). */
export async function isOnLoan(ctx: QueryCtx, toolId: Id<"tools">, today: string) {
  const active = await activeLoans(ctx, toolId);
  return active.some((l) => l.startDate <= today);
}
