"""Generates the n8n workflow JSON files in n8n/workflows. Run: python3 scripts/gen-workflows.py"""
import json, uuid

ERR_ID = "lendloopErrHandler01"
SMTP = {"smtp": {"id": "lendloopSmtp01", "name": "LendLoop SMTP"}}

def nid(name): return str(uuid.uuid5(uuid.NAMESPACE_DNS, name))

def node(name, type_, version, params, pos, **extra):
    n = {"id": nid(name), "name": name, "type": type_, "typeVersion": version, "position": pos, "parameters": params}
    n.update(extra)
    return n

def conn(*pairs):
    c = {}
    for src, out, dst in pairs:
        c.setdefault(src, {"main": []})
        while len(c[src]["main"]) <= out: c[src]["main"].append([])
        c[src]["main"][out].append({"node": dst, "type": "main", "index": 0})
    return c

SIGN = """const crypto = require('crypto');
const secret = $env.N8N_SHARED_SECRET;
if (!secret) throw new Error('N8N_SHARED_SECRET is not set');
const ts = String(Date.now());
const method = '%(method)s';
const path = '%(path)s';
const body = %(body)s;
const signature = crypto.createHmac('sha256', secret).update(`${ts}.${method}.${path}.${body}`).digest('hex');
return [{ json: { ts, signature, body, extra: %(extra)s } }];"""

def signed_http(name, method, path, pos, body_expr_is_json=True):
    params = {
        "method": method,
        "url": "={{ $env.CONVEX_SITE_URL }}" + path,
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "x-lendloop-timestamp", "value": "={{ $json.ts }}"},
            {"name": "x-lendloop-signature", "value": "={{ $json.signature }}"},
        ]},
        "options": {"timeout": 15000},
    }
    if method == "POST":
        params.update({"sendBody": True, "contentType": "raw", "rawContentType": "application/json", "body": "={{ $json.body }}"})
    return node(name, "n8n-nodes-base.httpRequest", 4.2, params, pos,
                retryOnFail=True, maxTries=3, waitBetweenTries=2000)

# ---------------------------------------------------------------- 1. notifications
VERIFY = """// Verify the HMAC signature Convex put on the request, and reject stale timestamps (replay protection).
const crypto = require('crypto');
const item = $input.first().json;
const secret = $env.N8N_SHARED_SECRET;
const ts = item.headers['x-lendloop-timestamp'];
const sig = item.headers['x-lendloop-signature'];
let ok = false;
if (secret && ts && sig && Math.abs(Date.now() - Number(ts)) < 5 * 60 * 1000) {
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${ts}.${JSON.stringify(item.body)}`).digest('hex'));
  const given = Buffer.from(String(sig).toLowerCase());
  ok = expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
return [{ json: { ok, body: ok ? item.body : null } }];"""

BUILD = """// Build the email for one event. Skip events we already delivered (Convex may retry a delivery).
const { eventId, event, loan, recipient } = $input.first().json.body;
const seen = $getWorkflowStaticData('global');
seen.done = seen.done || {};
if (seen.done[eventId]) return [{ json: { skip: true, eventId } }];
if (!recipient.email) return [{ json: { skip: true, eventId, reason: 'recipient has no email' } }];
const dates = `${loan.startDate} to ${loan.endDate}`;
const t = {
  requested:       ['New request for your ' + loan.toolName, `Someone would like to borrow your ${loan.toolName} (${dates}). Open LendLoop to approve or decline.`],
  withdrawn:       ['Request withdrawn: ' + loan.toolName, `The request to borrow your ${loan.toolName} (${dates}) was withdrawn.`],
  approved:        ['Approved: ' + loan.toolName, `Good news, your request for ${loan.toolName} (${dates}) was approved.`],
  declined:        ['Declined: ' + loan.toolName, `Your request for ${loan.toolName} (${dates}) was declined.`],
  returned:        ['Returned: ' + loan.toolName, `${loan.toolName} was marked as returned. Thanks for taking care of it.`],
  listing_removed: ['Listing removed: ' + loan.toolName, `Your request for ${loan.toolName} (${dates}) was cancelled because the listing was removed.`],
}[event];
if (!t) throw new Error('Unknown event: ' + event);
return [{ json: { skip: false, eventId, to: recipient.email, subject: t[0], text: `Hi ${recipient.name},\\n\\n${t[1]}\\n\\nLendLoop` } }];"""

MARK = """const seen = $getWorkflowStaticData('global');
seen.done = seen.done || {};
const id = $('Build email').first().json.eventId;
seen.done[id] = Date.now();
const keys = Object.keys(seen.done);
if (keys.length > 500) keys.sort((a, b) => seen.done[a] - seen.done[b]).slice(0, keys.length - 500).forEach((k) => delete seen.done[k]);
return [{ json: { ok: true } }];"""

def email_node(name, pos, to, subject, text, **extra):
    return node(name, "n8n-nodes-base.emailSend", 2.1, {
        "fromEmail": "={{ $env.MAIL_FROM || 'lendloop@example.com' }}",
        "toEmail": to, "subject": subject, "emailFormat": "text", "text": text, "options": {"appendAttribution": False},
    }, pos, credentials=SMTP, **extra)

notify = {
    "id": "lendloopNotify001",
    "name": "LendLoop - Loan status notifications",
    "nodes": [
        node("Webhook", "n8n-nodes-base.webhook", 2, {"httpMethod": "POST", "path": "lendloop-status", "responseMode": "responseNode", "options": {}}, [0, 0], webhookId=nid("webhook-status")),
        node("Verify signature", "n8n-nodes-base.code", 2, {"jsCode": VERIFY}, [220, 0]),
        node("Signature valid?", "n8n-nodes-base.if", 2.2, {"conditions": {"options": {"caseSensitive": True, "typeValidation": "strict", "version": 2}, "combinator": "and", "conditions": [{"id": nid("c1"), "leftValue": "={{ $json.ok }}", "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]}, "options": {}}, [440, 0]),
        node("Respond 401", "n8n-nodes-base.respondToWebhook", 1.4, {"respondWith": "json", "responseBody": "={{ {error: 'invalid signature'} }}", "options": {"responseCode": 401}}, [660, 160]),
        node("Build email", "n8n-nodes-base.code", 2, {"jsCode": BUILD}, [660, -80]),
        node("Already sent or nothing to send?", "n8n-nodes-base.if", 2.2, {"conditions": {"options": {"caseSensitive": True, "typeValidation": "strict", "version": 2}, "combinator": "and", "conditions": [{"id": nid("c2"), "leftValue": "={{ $json.skip }}", "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]}, "options": {}}, [880, -80]),
        email_node("Send email", [1100, 20], "={{ $json.to }}", "={{ $json.subject }}", "={{ $json.text }}"),
        node("Mark delivered", "n8n-nodes-base.code", 2, {"jsCode": MARK}, [1320, 20]),
        node("Respond 200", "n8n-nodes-base.respondToWebhook", 1.4, {"respondWith": "json", "responseBody": "={{ {ok: true} }}", "options": {"responseCode": 200}}, [1540, -80]),
    ],
    "connections": conn(
        ("Webhook", 0, "Verify signature"), ("Verify signature", 0, "Signature valid?"),
        ("Signature valid?", 0, "Build email"), ("Signature valid?", 1, "Respond 401"),
        ("Build email", 0, "Already sent or nothing to send?"),
        ("Already sent or nothing to send?", 0, "Respond 200"), ("Already sent or nothing to send?", 1, "Send email"),
        ("Send email", 0, "Mark delivered"), ("Mark delivered", 0, "Respond 200"),
    ),
    "settings": {"executionOrder": "v1", "errorWorkflow": ERR_ID, "saveDataErrorExecution": "all"},
    "active": False,
}

# ---------------------------------------------------------------- 2. daily overdue reminders
def sign_code(method, path, body, extra="null"):
    return SIGN % {"method": method, "path": path, "body": body, "extra": extra}

RESULT_SENT = """const crypto = require('crypto');
const secret = $env.N8N_SHARED_SECRET;
const loan = $('Each overdue loan').item.json;
const ts = String(Date.now());
const body = JSON.stringify({ key: loan.reminderKey, status: '%s'%s });
const signature = crypto.createHmac('sha256', secret).update(`${ts}.POST./n8n/reminder-result.${body}`).digest('hex');
return [{ json: { ts, signature, body } }];"""

reminder = {
    "id": "lendloopReminder01",
    "name": "LendLoop - Daily overdue reminders",
    "nodes": [
        node("Every day at 09:00", "n8n-nodes-base.scheduleTrigger", 1.2, {"rule": {"interval": [{"field": "cronExpression", "expression": "0 9 * * *"}]}}, [0, 0]),
        node("Run now (manual)", "n8n-nodes-base.manualTrigger", 1, {}, [0, 200]),
        node("Sign request", "n8n-nodes-base.code", 2, {"jsCode": sign_code("GET", "/n8n/overdue-loans", "''")}, [220, 0]),
        signed_http("Fetch overdue loans", "GET", "/n8n/overdue-loans", [440, 0]),
        node("Each overdue loan", "n8n-nodes-base.splitOut", 1, {"fieldToSplitOut": "loans", "options": {}}, [660, 0]),
        email_node("Send reminder", [880, 0], "={{ $json.borrower.email }}",
                   "=Reminder: please return {{ $json.toolName }}",
                   "=Hi {{ $json.borrower.name }},\n\nYour loan of {{ $json.toolName }} was due on {{ $json.dueDate }} ({{ $json.daysOverdue }} day(s) ago). Please return it to its owner as soon as you can.\n\nLendLoop",
                   onError="continueErrorOutput"),
        node("Result: sent", "n8n-nodes-base.code", 2, {"jsCode": RESULT_SENT % ("sent", "")}, [1100, -80]),
        node("Result: failed", "n8n-nodes-base.code", 2, {"jsCode": RESULT_SENT % ("failed", ", detail: String($json.error && $json.error.message || 'email failed')")}, [1100, 100]),
        signed_http("Record sent (idempotent)", "POST", "/n8n/reminder-result", [1320, -80]),
        signed_http("Record failure (idempotent)", "POST", "/n8n/reminder-result", [1320, 100]),
    ],
    "connections": conn(
        ("Every day at 09:00", 0, "Sign request"), ("Run now (manual)", 0, "Sign request"), ("Sign request", 0, "Fetch overdue loans"),
        ("Fetch overdue loans", 0, "Each overdue loan"), ("Each overdue loan", 0, "Send reminder"),
        ("Send reminder", 0, "Result: sent"), ("Send reminder", 1, "Result: failed"),
        ("Result: sent", 0, "Record sent (idempotent)"), ("Result: failed", 0, "Record failure (idempotent)"),
    ),
    "settings": {"executionOrder": "v1", "errorWorkflow": ERR_ID, "saveDataErrorExecution": "all"},
    "active": False,
}

# ---------------------------------------------------------------- 3. error handler
ERR_SIGN = """const crypto = require('crypto');
const secret = $env.N8N_SHARED_SECRET;
const e = $input.first().json;
const ts = String(Date.now());
const body = JSON.stringify({
  executionId: String(e.execution && e.execution.id || Date.now()),
  workflow: String(e.workflow && e.workflow.name || 'unknown'),
  message: String(e.execution && e.execution.error && e.execution.error.message || 'unknown error').slice(0, 250),
});
const signature = crypto.createHmac('sha256', secret).update(`${ts}.POST./n8n/failure.${body}`).digest('hex');
return [{ json: { ts, signature, body } }];"""

errwf = {
    "id": ERR_ID,
    "name": "LendLoop - Error handler",
    "nodes": [
        node("Error Trigger", "n8n-nodes-base.errorTrigger", 1, {}, [0, 0]),
        node("Sign failure report", "n8n-nodes-base.code", 2, {"jsCode": ERR_SIGN}, [220, 0]),
        signed_http("Report failure to LendLoop", "POST", "/n8n/failure", [440, 0]),
    ],
    "connections": conn(("Error Trigger", 0, "Sign failure report"), ("Sign failure report", 0, "Report failure to LendLoop")),
    "settings": {"executionOrder": "v1"},
    "active": False,
}

for wf, fname in [(notify, "01-loan-status-notifications"), (reminder, "02-daily-overdue-reminders"), (errwf, "00-error-handler")]:
    wf["pinData"] = {}
    wf["meta"] = {"templateCredsSetupCompleted": True}
    json.dump(wf, open(f"n8n/workflows/{fname}.json", "w"), indent=2)
    print("wrote", fname)

json.dump([{"id": "lendloopSmtp01", "name": "LendLoop SMTP", "type": "smtp",
            "data": {"host": "mailpit", "port": 1025, "user": "", "password": "", "secure": False, "disableStartTls": True}}],
          open("n8n/credentials/smtp.json", "w"), indent=2)
