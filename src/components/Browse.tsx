"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES, errorMessage, today, type Category } from "@/lib";
import { Badge, btn, btnGhost, ErrorNote, input } from "./ui";

export default function Browse() {
  const tools = useQuery(api.tools.listForMembers, {});
  const [category, setCategory] = useState<Category | "all">("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [open, setOpen] = useState<Id<"tools"> | null>(null);

  if (tools === undefined) return <p className="text-stone-500">Loading…</p>;
  const shown = tools.filter((t) => (category === "all" || t.category === category) && (!onlyAvailable || t.available));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">Category{" "}
          <select className="rounded-md border border-stone-300 bg-white px-2 py-1" value={category} onChange={(e) => setCategory(e.target.value as Category | "all")}>
            <option value="all">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> Available only
        </label>
      </div>
      {shown.length === 0 && <p className="text-stone-500">No tools match.</p>}
      <ul className="space-y-3">
        {shown.map((t) => (
          <li key={t._id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-sm capitalize text-stone-500">{t.category} · {t.condition}</p>
                <p className="mt-1 text-sm text-stone-700">{t.description}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Badge tone={t.available ? "green" : "amber"}>{t.available ? "Available" : "On loan"}</Badge>
                {t.trustedLender && <Badge tone="green">Trusted Lender</Badge>}
                {t.isMine ? <Badge>Yours</Badge> : (
                  <button className={btnGhost} onClick={() => setOpen(open === t._id ? null : t._id)}>
                    {open === t._id ? "Close" : "Request"}
                  </button>
                )}
              </div>
            </div>
            {open === t._id && <RequestForm toolId={t._id} onDone={() => setOpen(null)} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="mt-3 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try { await request({ toolId, startDate: start, endDate: end }); onDone(); }
        catch (err) { setError(errorMessage(err)); }
        finally { setBusy(false); }
      }}>
      <label className="text-sm">From<input className={input} type="date" min={today()} value={start} onChange={(e) => setStart(e.target.value)} required /></label>
      <label className="text-sm">Until<input className={input} type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
      <button className={btn} disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
      <div className="w-full"><ErrorNote message={error} /></div>
    </form>
  );
}
