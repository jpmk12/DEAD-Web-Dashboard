"use client";

import { useEffect, useState } from "react";
import type { Contact, ContactStatus } from "@/lib/contacts";

type Row = Contact & { status: ContactStatus };

const CADENCES = [
  { d: 30, label: "Monthly" },
  { d: 60, label: "Every 2 mo" },
  { d: 90, label: "Quarterly" },
  { d: 180, label: "Twice a yr" },
  { d: 365, label: "Yearly" },
];

// Due-state → display. "never"/"overdue"/"due" demand attention; "soon" is a
// heads-up; "fresh" is muted.
function statusChip(s: ContactStatus): { text: string; cls: string } {
  switch (s.state) {
    case "never":   return { text: "never contacted", cls: "text-rose-300 bg-rose-500/10 border-rose-500/40" };
    case "overdue": return { text: `overdue ${Math.abs(s.daysUntil ?? 0)}d`, cls: "text-rose-300 bg-rose-500/10 border-rose-500/40" };
    case "due":     return { text: "due today", cls: "text-amber-300 bg-amber-500/10 border-amber-500/40" };
    case "soon":    return { text: `due in ${s.daysUntil}d`, cls: "text-amber-300/80 bg-amber-500/[0.06] border-amber-500/30" };
    default:        return { text: `in ${s.daysUntil}d`, cls: "text-slate-500 bg-slate-800/60 border-slate-700" };
  }
}

export default function KeepInTouchPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cadence, setCadence] = useState(90);
  const [showFresh, setShowFresh] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((d: { contacts?: Row[] }) => setRows(Array.isArray(d.contacts) ? d.contacts : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const add = async () => {
    if (!name.trim()) return;
    const res = await fetch("/api/contacts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), email: email.trim() || undefined, cadenceDays: cadence }),
    });
    if (res.ok) { setName(""); setEmail(""); setAdding(false); load(); }
  };

  const markContacted = async (id: string) => {
    setBusyId(id);
    await fetch("/api/contacts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "contacted" }) }).catch(() => {});
    setBusyId(null); load();
  };

  const schedule = async (id: string, who: string) => {
    setBusyId(id);
    const res = await fetch("/api/contacts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "schedule" }) });
    setBusyId(null);
    flash(res.ok ? `📅 Check-in with ${who} added to your calendar` : "Couldn't add the event");
  };

  const remove = async (id: string) => {
    await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const needsAttention = rows.filter((r) => r.status.state !== "fresh");
  const fresh = rows.filter((r) => r.status.state === "fresh");
  const visible = showFresh ? rows : needsAttention;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <span className="text-rose-400 text-xs">♥</span>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Keep in Touch</h3>
        {needsAttention.length > 0 && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">{needsAttention.length} due</span>
        )}
        <button onClick={() => setAdding((v) => !v)} className="ml-auto text-slate-500 hover:text-emerald-400 text-sm" title="Add a person">＋</button>
      </div>

      {adding && (
        <div className="px-4 py-3 border-b border-slate-800 space-y-2 bg-slate-900/40">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600" />
          <div className="flex items-center gap-2">
            <select value={cadence} onChange={(e) => setCadence(Number(e.target.value))} className="bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1.5 text-[11px] text-slate-300 outline-none">
              {CADENCES.map((c) => <option key={c.d} value={c.d}>{c.label}</option>)}
            </select>
            <button onClick={add} disabled={!name.trim()} className="ml-auto px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 transition-all">Add</button>
          </div>
        </div>
      )}

      {toast && <div className="px-4 py-1.5 text-[10px] text-emerald-400 bg-emerald-500/[0.06] border-b border-slate-800">{toast}</div>}

      {loading ? (
        <div className="px-4 py-4 space-y-2">{[1, 2].map((i) => <div key={i} className="h-9 bg-slate-800/50 rounded animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-[11px] text-slate-600 font-mono text-center leading-relaxed">No one on your list yet.<br />＋ add the people you want to keep tabs on.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-800/60 max-h-[40vh] overflow-y-auto">
            {visible.map((r) => {
              const chip = statusChip(r.status);
              return (
                <li key={r.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-slate-200 truncate">{r.name}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${chip.cls}`}>{chip.text}</span>
                    <button onClick={() => remove(r.id)} className="ml-auto text-slate-700 hover:text-red-400 text-[11px] flex-shrink-0" title="Remove">✕</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => markContacted(r.id)} disabled={busyId === r.id} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300/90 hover:bg-emerald-500/10 disabled:opacity-40 transition-all" title="Reset the clock — you reached out">✓ Contacted</button>
                    <button onClick={() => schedule(r.id, r.name)} disabled={busyId === r.id} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-sky-500/30 text-sky-300/90 hover:bg-sky-500/10 disabled:opacity-40 transition-all" title="Drop a check-in event on your calendar">📅 Schedule</button>
                    <span className="ml-auto text-[9px] font-mono text-slate-600">every {r.cadenceDays}d</span>
                  </div>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-4 py-5 text-[11px] text-emerald-400/80 font-mono text-center">✓ All caught up — no one is due.</li>
            )}
          </ul>
          {fresh.length > 0 && (
            <button onClick={() => setShowFresh((v) => !v)} className="w-full px-4 py-1.5 text-[10px] font-mono text-slate-600 hover:text-slate-400 border-t border-slate-800/60 transition-colors">
              {showFresh ? "▴ hide caught-up" : `▾ ${fresh.length} caught up`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
