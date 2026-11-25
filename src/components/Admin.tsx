"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib";
import { Badge, btnGhost, ErrorNote, statusTone } from "./ui";
import { AutomationNote } from "./Loans";

export default function Admin() {
  const users = useQuery(api.users.listAll, {});
  const loans = useQuery(api.loans.listAll, {});
  const tools = useQuery(api.tools.listForMembers, {});
  const problems = useQuery(api.automation.recentProblems, {});
  const setTrusted = useMutation(api.users.setTrustedLender);
  const remove = useMutation(api.tools.remove);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); } catch (e) { setError(errorMessage(e)); } };

  if (!users || !loans || !tools || !problems) return <p className="text-stone-500">Loading…</p>;
  return (
    <div className="space-y-8">
      <ErrorNote message={error} />
      <section>
        <h2 className="mb-3 text-lg font-semibold">Automation problems</h2>
        {problems.length === 0 ? <p className="text-stone-500">No failed or retrying automation runs.</p> : (
          <ul className="space-y-2">
            {problems.map((p) => (
              <li key={p._id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <Badge tone={p.status === "failed" ? "red" : "amber"}>{p.status}</Badge> {p.kind.replace("_", " ")} · {p.attempts} attempt(s)
                <p className="text-stone-700">{p.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Members</h2>
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u._id} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-3">
              <span>{u.name} {u.role === "admin" && <Badge tone="blue">Admin</Badge>} {u.trustedLender && <Badge tone="green">Trusted Lender</Badge>}</span>
              <button className={btnGhost} onClick={() => run(() => setTrusted({ userId: u._id, trusted: !u.trustedLender }))}>
                {u.trustedLender ? "Remove Trusted Lender" : "Mark Trusted Lender"}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">All listings</h2>
        <ul className="space-y-2">
          {tools.map((t) => (
            <li key={t._id} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-3">
              <span>{t.name} <span className="text-sm capitalize text-stone-500">({t.category})</span></span>
              <button className={btnGhost} onClick={() => confirm(`Remove “${t.name}”?`) && run(() => remove({ toolId: t._id }))}>Remove</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">All loans</h2>
        <ul className="space-y-2">
          {loans.map((l) => (
            <li key={l._id} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <div className="flex items-center justify-between">
                <span>{l.toolName}: {l.lenderName} → {l.borrowerName}, {l.startDate} to {l.endDate}</span>
                <span className="flex gap-1"><Badge tone={statusTone(l.status)}>{l.status}</Badge>{l.overdue && <Badge tone="red">Overdue</Badge>}</span>
              </div>
              <AutomationNote a={l.lastAutomation} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
