import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { hmacHex } from "./lib/hmac";
import type { LoanEvent } from "./lib/notify";

export const MAX_ATTEMPTS = 5;
/** Backoff after attempt n fails: 30s, 2m, 10m, 1h. */
export const retryDelayMs = (attempt: number) => [30_000, 120_000, 600_000, 3_600_000][attempt - 1] ?? 3_600_000;

const TO_LENDER: LoanEvent[] = ["requested", "withdrawn"];

/**
 * What n8n receives. Data minimisation: only the fields a notification needs,
 * for exactly one recipient. No other party's details, no ids besides the event.
 */
export const payload = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const ev = await ctx.db.get(eventId);
    if (!ev || ev.kind !== "status_notification" || !ev.loanId) return null;
    if (ev.status === "sent" || ev.status === "failed") return null; // done: never send twice
    const loan = await ctx.db.get(ev.loanId);
    if (!loan) return null;
    const event = ev.key.split(":")[2] as LoanEvent;
    const recipient = await ctx.db.get(TO_LENDER.includes(event) ? loan.ownerId : loan.borrowerId);
    if (!recipient) return null;
    return {
      eventId: ev.key,
      event,
      sentAt: new Date().toISOString(),
      loan: { toolName: loan.toolName, startDate: loan.startDate, endDate: loan.endDate },
      recipient: { name: recipient.name, email: recipient.email ?? null },
    };
  },
});

export const recordResult = internalMutation({
  args: { eventId: v.id("automationEvents"), ok: v.boolean(), error: v.optional(v.string()), final: v.optional(v.boolean()) },
  handler: async (ctx, { eventId, ok, error, final }) => {
    const ev = await ctx.db.get(eventId);
    if (!ev) return { retryInMs: null };
    const attempts = ev.attempts + 1;
    if (ok) {
      await ctx.db.patch(eventId, { status: "sent", attempts, detail: undefined, updatedAt: Date.now() });
      return { retryInMs: null };
    }
    const exhausted = final || attempts >= MAX_ATTEMPTS;
    await ctx.db.patch(eventId, {
      status: exhausted ? "failed" : "retrying",
      attempts,
      detail: (error ?? "unknown error").slice(0, 300),
      updatedAt: Date.now(),
    });
    return { retryInMs: exhausted ? null : retryDelayMs(attempts) };
  },
});

/**
 * Signed POST to the n8n webhook. Failures are recorded and retried with backoff;
 * after MAX_ATTEMPTS the event is marked failed, which the admin panel shows.
 */
export const deliver = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const body = await ctx.runQuery(internal.notifications.payload, { eventId });
    if (!body) return;
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_SHARED_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordResult, {
        eventId, ok: false, final: true, error: "N8N_WEBHOOK_URL or N8N_SHARED_SECRET is not set",
      });
      return;
    }
    const text = JSON.stringify(body);
    const timestamp = String(Date.now());
    const signature = await hmacHex(secret, `${timestamp}.${text}`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": timestamp,
          "x-lendloop-signature": signature,
        },
        body: text,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`n8n answered HTTP ${res.status}`);
      await ctx.runMutation(internal.notifications.recordResult, { eventId, ok: true });
    } catch (e) {
      const r = await ctx.runMutation(internal.notifications.recordResult, {
        eventId, ok: false, error: e instanceof Error ? e.message : String(e),
      });
      if (r.retryInMs !== null) {
        await ctx.scheduler.runAfter(r.retryInMs, internal.notifications.deliver, { eventId });
      }
    }
  },
});
