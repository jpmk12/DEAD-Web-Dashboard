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
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<{ name: string; email: string; reason: string }[]>([]);

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

  // Tomorrow 09:00 (wall-clock) as a datetime-local default; the user can pick
  // any time before confirming.
  const defaultWhen = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`;
  };
  const openSchedule = (id: string) => { setSchedulingId(id); setWhen(defaultWhen()); };

  const schedule = async (id: string, who: string) => {
    setBusyId(id);
    const res = await fetch("/api/contacts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "schedule", when: when || undefined }) });
    setBusyId(null); setSchedulingId(null);
    flash(res.ok ? `📅 Check-in with ${who} added to your calendar` : "Couldn't add the event");
  };

  const remove = async (id: string) => {
    await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const openSuggest = () => {
    const next = !suggestOpen;
    setSuggestOpen(next);
    if (next && suggestions.length === 0) {
      setSuggestLoading(true);
      fetch("/api/contacts/suggest")
        .then((r) => r.json())
        .then((d: { suggestions?: { name: string; email: string; reason: string }[] }) => setSuggestions(d.suggestions ?? []))
        .catch(() => {})
        .finally(() => setSuggestLoading(false));
    }
  };

  const addSuggested = async (s: { name: string; email: string }) => {
    const res = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name, email: s.email, cadenceDays: 90 }) });
    if (res.ok) { setSuggestions((prev) => prev.filter((x) => x.email !== s.email)); load(); }
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
        <button onClick={openSuggest} className="ml-auto text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-violet-300 transition-colors" title="Suggest people from your VIPs + who you email most">✨ Suggest</button>
        <button onClick={() => setAdding((v) => !v)} className="text-slate-500 hover:text-emerald-400 text-sm" title="Add a person">＋</button>
      </div>

      {suggestOpen && (
        <div className="px-4 py-3 border-b border-slate-800 bg-violet-500/[0.03]">
          <p className="text-[10px] text-slate-600 mb-2">From your VIPs and the people you email most — one tap to add (defaults to quarterly; edit later).</p>
          {suggestLoading ? (
            <div className="h-8 bg-slate-800/50 rounded animate-pulse" />
          ) : suggestions.length === 0 ? (
            <p className="text-[11px] text-slate-600 font-mono">No new suggestions — everyone's already on your list, or no VIP/reply data yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {suggestions.map((s) => (
                <li key={s.email} className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-200 font-medium truncate">{s.name}</span>
                  <span className="text-[9px] font-mono text-violet-300/70 flex-shrink-0">{s.reason}</span>
                  <button onClick={() => addSuggested(s)} className="ml-auto px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300/90 hover:bg-emerald-500/10 text-[10px] font-bold uppercase tracking-wider flex-shrink-0 transition-all" title={s.email}>＋ Add</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
                    <button onClick={() => (schedulingId === r.id ? setSchedulingId(null) : openSchedule(r.id))} disabled={busyId === r.id} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border transition-all disabled:opacity-40 ${schedulingId === r.id ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-sky-500/30 text-sky-300/90 hover:bg-sky-500/10"}`} title="Drop a check-in event on your calendar">📅 Schedule</button>
                    <span className="ml-auto text-[9px] font-mono text-slate-600">every {r.cadenceDays}d</span>
                  </div>
                  {schedulingId === r.id && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap rounded-lg border border-sky-500/30 bg-sky-500/[0.05] px-2.5 py-2">
                      <label className="text-[10px] font-mono text-slate-500">When</label>
                      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-sky-500/40" />
                      <button onClick={() => schedule(r.id, r.name)} disabled={busyId === r.id || !when} className="ml-auto px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40 transition-all">Add to calendar</button>
                      <button onClick={() => setSchedulingId(null)} className="text-slate-600 hover:text-slate-300 text-xs">×</button>
                    </div>
                  )}
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
