import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const category = v.union(
  v.literal("power tools"),
  v.literal("hand tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);

export const condition = v.union(
  v.literal("like new"),
  v.literal("good"),
  v.literal("worn"),
);

export const loanStatus = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
  v.literal("cancelled"),
);

export default defineSchema({
  users: defineTable({
    // Clerk's stable identity (`tokenIdentifier`). Never taken from the client.
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    // Roles live here, in the database, and can only be changed server-side.
    role: v.union(v.literal("user"), v.literal("admin")),
    trustedLender: v.boolean(),
    createdAt: v.number(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
    createdAt: v.number(),
    // Soft delete keeps loan history and the audit trail intact.
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(), // snapshot so history survives edits and removal
    ownerId: v.id("users"), // lender
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD (UTC)
    endDate: v.string(),
    status: loanStatus,
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status", ["status"]),

  // One row per automation side effect (webhook delivery, reminder, failure).
  // `key` makes every write idempotent, so retries never duplicate anything.
  automationEvents: defineTable({
    key: v.string(),
    kind: v.union(
      v.literal("status_notification"),
      v.literal("overdue_reminder"),
      v.literal("workflow_failure"),
    ),
    loanId: v.optional(v.id("loans")),
    status: v.union(
      v.literal("pending"),
      v.literal("retrying"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"]),
});
