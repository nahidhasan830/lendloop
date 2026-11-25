/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const identity = (n: string) => ({
  subject: n,
  tokenIdentifier: `https://clerk.test|${n}`,
  name: n,
  email: `${n}@example.com`,
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const as = (n: string) => t.withIdentity(identity(n));
  for (const n of ["alice", "bob", "carol", "admin"]) await as(n).mutation(api.users.store, {});
  await t.mutation(internal.users.setRoleByEmail, { email: "admin@example.com", role: "admin" });
  const toolId = await as("alice").mutation(api.tools.create, {
    name: "Cordless drill", category: "power tools", condition: "good", description: "18V, two batteries",
  });
  return { t, as, toolId };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("authentication", () => {
  it("rejects every member function when signed out", async () => {
    const { t, toolId } = await setup();
    await expect(t.query(api.tools.listForMembers, {})).rejects.toThrow("Not signed in");
    await expect(t.mutation(api.tools.create, { name: "x", category: "other", condition: "good", description: "y" })).rejects.toThrow("Not signed in");
    await expect(t.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) })).rejects.toThrow("Not signed in");
  });

  it("public list works signed out and leaks no owner or description", async () => {
    const { t } = await setup();
    const list = await t.query(api.tools.listPublic, {});
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(["_id", "available", "category", "name"]);
  });

  it("a client cannot choose its own role", async () => {
    const { as } = await setup();
    const me = await as("bob").query(api.users.me, {});
    expect(me?.role).toBe("user");
    await expect(as("bob").mutation(api.users.setTrustedLender, { userId: me!._id, trusted: true })).rejects.toThrow("Admin only");
  });
});

describe("listings", () => {
  it("owner edits and deletes; others cannot", async () => {
    const { as, toolId } = await setup();
    const fields = { toolId, name: "Drill", category: "power tools" as const, condition: "good" as const, description: "ok" };
    await expect(as("bob").mutation(api.tools.update, fields)).rejects.toThrow("only edit your own");
    await expect(as("admin").mutation(api.tools.update, fields)).rejects.toThrow("only edit your own");
    await expect(as("bob").mutation(api.tools.remove, { toolId })).rejects.toThrow("only delete your own");
    await as("alice").mutation(api.tools.update, fields);
    await as("alice").mutation(api.tools.remove, { toolId });
    expect(await as("bob").query(api.tools.listForMembers, {})).toHaveLength(0);
  });

  it("admin can remove any listing and it cancels open requests", async () => {
    const { as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(3) });
    await as("admin").mutation(api.tools.remove, { toolId });
    const mine = await as("bob").query(api.loans.myRequests, {});
    expect(mine.find((l) => l._id === loanId)?.status).toBe("cancelled");
  });

  it("validates input", async () => {
    const { as } = await setup();
    await expect(as("alice").mutation(api.tools.create, { name: "  ", category: "other", condition: "good", description: "x" })).rejects.toThrow("Name is required");
  });
});

describe("loans", () => {
  it("full happy path: request, approve, return", async () => {
    const { as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(2) });
    expect(await as("alice").query(api.loans.incoming, {})).toHaveLength(1);
    await as("alice").mutation(api.loans.decide, { loanId, decision: "approve" });
    expect((await as("bob").query(api.tools.listForMembers, {}))[0].available).toBe(false);
    await as("alice").mutation(api.loans.markReturned, { loanId });
    expect((await as("bob").query(api.tools.listForMembers, {}))[0].available).toBe(true);
  });

  it("only the owner can decide or mark returned", async () => {
    const { as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(1) });
    await expect(as("bob").mutation(api.loans.decide, { loanId, decision: "approve" })).rejects.toThrow("Only the tool's owner");
    await expect(as("carol").mutation(api.loans.decide, { loanId, decision: "approve" })).rejects.toThrow("Only the tool's owner");
    await expect(as("admin").mutation(api.loans.decide, { loanId, decision: "approve" })).rejects.toThrow("Only the tool's owner");
    await as("alice").mutation(api.loans.decide, { loanId, decision: "approve" });
    await expect(as("bob").mutation(api.loans.markReturned, { loanId })).rejects.toThrow("Only the tool's owner");
    await expect(as("alice").mutation(api.loans.decide, { loanId, decision: "decline" })).rejects.toThrow("already approved");
  });

  it("borrower sees only their own requests; lender sees only requests on their tools", async () => {
    const { as, toolId } = await setup();
    await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    expect(await as("carol").query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await as("carol").query(api.loans.incoming, {})).toHaveLength(0);
    expect(await as("bob").query(api.loans.incoming, {})).toHaveLength(0);
  });

  it("borrower view hides the lender's identity", async () => {
    const { as, toolId } = await setup();
    await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    const [row] = await as("bob").query(api.loans.myRequests, {});
    expect(row.lenderName).toBeUndefined();
    expect(row.borrowerName).toBeUndefined();
    const [lenderRow] = await as("alice").query(api.loans.incoming, {});
    expect(lenderRow.borrowerName).toBe("bob");
  });

  it("only admin lists every loan", async () => {
    const { as, toolId } = await setup();
    await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await expect(as("bob").query(api.loans.listAll, {})).rejects.toThrow("Admin only");
    expect(await as("admin").query(api.loans.listAll, {})).toHaveLength(1);
  });

  it("prevents borrowing your own tool, bad dates and overlapping approvals", async () => {
    const { as, toolId } = await setup();
    await expect(as("alice").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) })).rejects.toThrow("your own tool");
    await expect(as("bob").mutation(api.loans.request, { toolId, startDate: day(3), endDate: day(1) })).rejects.toThrow("on or after");
    await expect(as("bob").mutation(api.loans.request, { toolId, startDate: day(-2), endDate: day(1) })).rejects.toThrow("past");
    await expect(as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(60) })).rejects.toThrow("at most 30");
    const a = await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(5) });
    const b = await as("carol").mutation(api.loans.request, { toolId, startDate: day(4), endDate: day(8) });
    await as("alice").mutation(api.loans.decide, { loanId: a, decision: "approve" });
    await expect(as("alice").mutation(api.loans.decide, { loanId: b, decision: "approve" })).rejects.toThrow("already covers");
    await expect(as("carol").mutation(api.loans.request, { toolId, startDate: day(2), endDate: day(3) })).rejects.toThrow("already lent out");
  });

  it("borrower can withdraw only their own open request", async () => {
    const { as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await expect(as("carol").mutation(api.loans.cancel, { loanId })).rejects.toThrow("your own requests");
    await as("bob").mutation(api.loans.cancel, { loanId });
    await expect(as("bob").mutation(api.loans.cancel, { loanId })).rejects.toThrow("already cancelled");
  });
});

describe("trusted lender", () => {
  it("admin marks a lender and members see the badge", async () => {
    const { as } = await setup();
    const alice = (await as("alice").query(api.users.me, {}))!;
    await as("admin").mutation(api.users.setTrustedLender, { userId: alice._id, trusted: true });
    const list = await as("bob").query(api.tools.listForMembers, {});
    expect(list[0].trustedLender).toBe(true);
    await expect(as("alice").mutation(api.users.setTrustedLender, { userId: alice._id, trusted: false })).rejects.toThrow("Admin only");
  });
});

describe("automation", () => {
  it("notification payload holds only what the recipient needs", async () => {
    const { t, as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    const ev = await t.run(async (ctx) =>
      ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", `status:${loanId}:requested`)).unique(),
    );
    expect(ev).not.toBeNull();
    const body = await t.query(internal.notifications.payload, { eventId: ev!._id });
    expect(body?.recipient.name).toBe("alice"); // request goes to the lender
    expect(JSON.stringify(body)).not.toContain("bob"); // borrower identity is not sent to the lender's notification
    expect(Object.keys(body!).sort()).toEqual(["event", "eventId", "loan", "recipient", "sentAt"]);
  });

  it("enqueue is idempotent and a sent event is never re-sent", async () => {
    const { t, as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await as("alice").mutation(api.loans.decide, { loanId, decision: "approve" });
    const events = await t.run(async (ctx) => ctx.db.query("automationEvents").collect());
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    const ev = events[0];
    await t.mutation(internal.notifications.recordResult, { eventId: ev._id, ok: true });
    expect(await t.query(internal.notifications.payload, { eventId: ev._id })).toBeNull();
  });

  it("retries with backoff, then marks failed and shows it to admin", async () => {
    const { t, as, toolId } = await setup();
    await as("bob").mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    const ev = (await t.run(async (ctx) => ctx.db.query("automationEvents").collect()))[0];
    let last: { retryInMs: number | null } = { retryInMs: 0 };
    for (let i = 0; i < 4; i++) {
      last = await t.mutation(internal.notifications.recordResult, { eventId: ev._id, ok: false, error: "boom" });
      expect(last.retryInMs).not.toBeNull();
    }
    last = await t.mutation(internal.notifications.recordResult, { eventId: ev._id, ok: false, error: "boom" });
    expect(last.retryInMs).toBeNull();
    const problems = await as("admin").query(api.automation.recentProblems, {});
    expect(problems[0].status).toBe("failed");
    await expect(as("bob").query(api.automation.recentProblems, {})).rejects.toThrow("Admin only");
  });

  it("reminder write-back is idempotent", async () => {
    const { t, as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(1) });
    await as("alice").mutation(api.loans.decide, { loanId, decision: "approve" });
    const key = `reminder:${loanId}:${day(5)}`;
    const first = await t.mutation(internal.automation.recordReminder, { key, status: "sent" });
    const second = await t.mutation(internal.automation.recordReminder, { key, status: "sent" });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const rows = await t.run(async (ctx) => ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).collect());
    expect(rows).toHaveLength(1);
    await expect(t.mutation(internal.automation.recordReminder, { key: "reminder:bogus", status: "sent" })).rejects.toThrow("Bad reminder key");
  });

  it("overdue list excludes returned loans and already reminded ones", async () => {
    const { t, as, toolId } = await setup();
    const loanId = await as("bob").mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(1) });
    await as("alice").mutation(api.loans.decide, { loanId, decision: "approve" });
    const today = day(3);
    expect(await t.query(internal.automation.overdueForReminder, { today })).toHaveLength(1);
    await t.mutation(internal.automation.recordReminder, { key: `reminder:${loanId}:${today}`, status: "sent" });
    expect(await t.query(internal.automation.overdueForReminder, { today })).toHaveLength(0);
    expect(await t.query(internal.automation.overdueForReminder, { today: day(4) })).toHaveLength(1);
    await as("alice").mutation(api.loans.markReturned, { loanId });
    expect(await t.query(internal.automation.overdueForReminder, { today: day(4) })).toHaveLength(0);
  });
});
