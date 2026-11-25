import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifySignedRequest } from "./lib/hmac";
import { todayUtc } from "./lib/access";

const http = httpRouter();
const MAX_BODY = 8 * 1024;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Read the body (size-capped) and verify the HMAC signature before doing anything else. */
async function authenticate(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY) return { ok: false as const, res: json({ error: "payload too large" }, 413) };
  const check = await verifySignedRequest({
    secret: process.env.N8N_SHARED_SECRET,
    method: request.method,
    path: new URL(request.url).pathname,
    body,
    timestamp: request.headers.get("x-lendloop-timestamp"),
    signature: request.headers.get("x-lendloop-signature"),
    now: Date.now(),
  });
  if (!check.ok) return { ok: false as const, res: json({ error: check.reason }, 401) };
  return { ok: true as const, body };
}

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.res;
    const loans = await ctx.runQuery(internal.automation.overdueForReminder, { today: todayUtc() });
    return json({ loans });
  }),
});

http.route({
  path: "/n8n/reminder-result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.res;
    let data: { key?: unknown; status?: unknown; detail?: unknown };
    try { data = JSON.parse(auth.body); } catch { return json({ error: "invalid JSON" }, 400); }
    if (typeof data.key !== "string" || (data.status !== "sent" && data.status !== "failed")) {
      return json({ error: "key and status (sent|failed) are required" }, 400);
    }
    try {
      const r = await ctx.runMutation(internal.automation.recordReminder, {
        key: data.key,
        status: data.status,
        detail: typeof data.detail === "string" ? data.detail : undefined,
      });
      return json({ ok: true, ...r });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "failed" }, 400);
    }
  }),
});

http.route({
  path: "/n8n/failure",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.res;
    let data: { executionId?: unknown; workflow?: unknown; message?: unknown };
    try { data = JSON.parse(auth.body); } catch { return json({ error: "invalid JSON" }, 400); }
    if (typeof data.executionId !== "string" || typeof data.workflow !== "string") {
      return json({ error: "executionId and workflow are required" }, 400);
    }
    const r = await ctx.runMutation(internal.automation.recordWorkflowFailure, {
      executionId: data.executionId,
      workflow: data.workflow,
      message: typeof data.message === "string" ? data.message : "unknown error",
    });
    return json({ ok: true, ...r });
  }),
});

export default http;
