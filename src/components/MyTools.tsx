"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, errorMessage, type Category, type Condition } from "@/lib";
import { Badge, btn, btnGhost, ErrorNote, input } from "./ui";

type Draft = { name: string; category: Category; condition: Condition; description: string };
const empty: Draft = { name: "", category: "power tools", condition: "good", description: "" };

export default function MyTools() {
  const tools = useQuery(api.tools.mine, {});
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Id<"tools"> | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      if (editing === "new") await create(draft);
      else if (editing) await update({ toolId: editing, ...draft });
      setEditing(null);
    } catch (e) { setError(errorMessage(e)); }
  };

  if (tools === undefined) return <p className="text-stone-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My tools</h2>
        {!editing && <button className={btn} onClick={() => { setDraft(empty); setEditing("new"); }}>Add a tool</button>}
      </div>
      <ErrorNote message={error} />
      {editing && (
        <form className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="text-sm">Name<input className={input} value={draft.name} maxLength={80} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Category
              <select className={input} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select></label>
            <label className="text-sm">Condition
              <select className={input} value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value as Condition })}>
                {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
              </select></label>
          </div>
          <label className="text-sm">Description<textarea className={input} rows={3} maxLength={500} required value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="flex gap-2"><button className={btn}>Save</button><button type="button" className={btnGhost} onClick={() => setEditing(null)}>Cancel</button></div>
        </form>
      )}
      {tools.length === 0 && !editing && <p className="text-stone-500">You have not listed anything yet.</p>}
      <ul className="space-y-3">
        {tools.map((t) => (
          <li key={t._id} className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4">
            <div>
              <p className="font-medium">{t.name}</p>
              <p className="text-sm capitalize text-stone-500">{t.category} · {t.condition}</p>
              <p className="mt-1 text-sm">{t.description}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Badge tone={t.available ? "green" : "amber"}>{t.available ? "Available" : "On loan"}</Badge>
              <div className="flex gap-2">
                <button className={btnGhost} onClick={() => { setDraft({ name: t.name, category: t.category, condition: t.condition, description: t.description }); setEditing(t._id); }}>Edit</button>
                <button className={btnGhost} onClick={async () => {
                  if (!confirm(`Delete “${t.name}”? Open requests will be cancelled.`)) return;
                  try { await remove({ toolId: t._id }); } catch (e) { setError(errorMessage(e)); }
                }}>Delete</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
