"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/feedback";
import { invalidateEffectiveZone } from "@/lib/zoneClient";

// TDY is declared and ended where it is shown (REVIEW-2026-10 §12): ＋ TDY on
// the Calendar Today strip creates one; the TDY chip on the strip and on a
// day header ends it today or deletes it. Writes go to /api/trips (the same
// route the Preferences TripsEditor uses) and announce `trips:changed`, which
// the Calendar tab, the Weather tab's TDY card and the effective zone follow.

export function announceTripsChanged(): void {
  invalidateEffectiveZone();
  window.dispatchEvent(new Event("trips:changed"));
  window.dispatchEvent(new CustomEvent("dashboard-cache-cleared"));
}

type TripRef = { id: string; label: string; startDate: string; endDate: string } | null;

export function TripChip({ trip, label, today, small = false }: { trip: TripRef; label: string; today: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const call = async (init: RequestInit & { url: string }, said: string) => {
    setBusy(true);
    try {
      const r = await fetch(init.url, init);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error("Could not change the TDY", d?.error || `HTTP ${r.status}`); return; }
      announceTripsChanged();
      toast.ok(said);
      setOpen(false);
    } catch (e) { toast.error("Could not change the TDY", e); }
    finally { setBusy(false); }
  };
  const endToday = () => trip && call({ url: "/api/trips", method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: trip.id, endDate: today }) }, `${trip.label} ends today`);
  const remove = () => trip && call({ url: `/api/trips?id=${encodeURIComponent(trip.id)}`, method: "DELETE" }, `${trip.label} removed`);

  const cls = small
    ? "text-[8.5px] font-bold uppercase tracking-widest text-amber-300 bg-amber-500/12 border border-amber-500/25 rounded px-1.5 py-0.5 hover:bg-amber-500/20"
    : "text-[10px] font-mono text-amber-300 border border-amber-500/25 bg-amber-500/10 rounded px-1.5 py-0.5 hover:bg-amber-500/20";
  if (!trip) return <span className={cls}>{label}</span>;
  return (
    <span ref={wrap} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title="TDY — tap to end or remove" className={cls}>{label} ▾</button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 min-w-[220px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-2 text-left normal-case tracking-normal">
          <p className="text-[10px] text-slate-500 px-1 pb-1.5 font-sans">{trip.label} · {trip.startDate} → {trip.endDate}</p>
          {trip.endDate > today && <button role="menuitem" disabled={busy} onClick={endToday} className="w-full text-left text-[11px] text-slate-200 hover:bg-slate-800 rounded px-2 py-1.5 font-sans">⏹ End today</button>}
          <button role="menuitem" disabled={busy} onClick={remove} className="w-full text-left text-[11px] text-red-300 hover:bg-red-500/10 rounded px-2 py-1.5 font-sans">✕ Remove this TDY</button>
          <p className="text-[9.5px] text-slate-600 px-1 pt-1.5 font-sans">Dates and notes: Preferences → Content sources → Trips.</p>
        </div>
      )}
    </span>
  );
}

export function TripQuickAdd({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setStart(today); setEnd(today); } }, [open, today]);

  const submit = async () => {
    if (!location.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: location.trim(), startDate: start, endDate: end }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error("Could not add the TDY", d?.error || `HTTP ${r.status}`); return; }
      announceTripsChanged();
      toast.ok(`TDY ${d?.trip?.label ?? location} · ${start} → ${end}`);
      setLocation(""); setOpen(false);
    } catch (e) { toast.error("Could not add the TDY", e); }
    finally { setBusy(false); }
  };

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500" title="Declare a TDY — it sets the zone, the Weather card, the brief and the family's while-you-are-away list">＋ TDY</button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex items-center gap-1.5 flex-wrap">
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where (city, country)" autoFocus
        className="w-44 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60" />
      <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200" aria-label="Start" />
      <span className="text-slate-600 text-[10px]">→</span>
      <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200" aria-label="End" />
      <button type="submit" disabled={busy || !location.trim()} className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40">{busy ? "…" : "Add"}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200">Cancel</button>
    </form>
  );
}
