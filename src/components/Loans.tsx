"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib";
import { Badge, btn, btnGhost, ErrorNote, statusTone } from "./ui";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.loans.myRequests>>>[number];

export function AutomationNote({ a }: { a: Row["lastAutomation"] }) {
  if (!a) return null;
  const label = a.kind === "overdue_reminder" ? "Overdue reminder" : a.kind === "status_notification" ? "Notification" : "Automation";
  return <span className="text-xs text-stone-500">{label} {a.status} · {new Date(a.at).toLocaleString()}</span>;
}

export default function Loans() {
  const mine = useQuery(api.loans.myRequests, {});
  const incoming = useQuery(api.loans.incoming, {});
  const decide = useMutation(api.loans.decide);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); } catch (e) { setError(errorMessage(e)); } };

  if (mine === undefined || incoming === undefined) return <p className="text-stone-500">Loading…</p>;
  return (
    <div className="space-y-8">
      <ErrorNote message={error} />
      <section>
        <h2 className="mb-3 text-lg font-semibold">Requests for my tools</h2>
        {incoming.length === 0 && <p className="text-stone-500">Nobody has asked to borrow from you yet.</p>}
        <ul className="space-y-3">
          {incoming.map((l) => (
            <li key={l._id} className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{l.toolName} <span className="font-normal text-stone-500">for {l.borrowerName}</span></p>
                  <p className="text-sm text-stone-600">{l.startDate} → {l.endDate}</p>
                  <AutomationNote a={l.lastAutomation} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-1">
                    <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                    {l.overdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                  {l.status === "requested" && (
                    <div className="flex gap-2">
                      <button className={btn} onClick={() => run(() => decide({ loanId: l._id, decision: "approve" }))}>Approve</button>
                      <button className={btnGhost} onClick={() => run(() => decide({ loanId: l._id, decision: "decline" }))}>Decline</button>
                    </div>
                  )}
                  {l.status === "approved" && <button className={btn} onClick={() => run(() => markReturned({ loanId: l._id }))}>Mark returned</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">My requests</h2>
        {mine.length === 0 && <p className="text-stone-500">You have not asked to borrow anything.</p>}
        <ul className="space-y-3">
          {mine.map((l) => (
            <li key={l._id} className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4">
              <div>
                <p className="font-medium">{l.toolName}</p>
                <p className="text-sm text-stone-600">{l.startDate} → {l.endDate}</p>
                <AutomationNote a={l.lastAutomation} />
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-1">
                  <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                  {l.overdue && <Badge tone="red">Overdue</Badge>}
                </div>
                {l.status === "requested" && <button className={btnGhost} onClick={() => run(() => cancel({ loanId: l._id }))}>Withdraw</button>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
