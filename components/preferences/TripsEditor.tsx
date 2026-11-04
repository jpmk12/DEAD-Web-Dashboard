"use client";

import { useEffect, useState } from "react";
import { clientCache } from "@/lib/clientCache";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

// ─── TDY / travel trips editor ───────────────────────────────────────────────
// Self-contained (own /api/trips endpoint, not the main prefs blob). The active
// trip becomes the effective location — overrides home for weather + the brief.
interface TripRow { id: string; label: string; location: string; startDate: string; endDate: string; feedKey: string | null; source?: "manual" | "calendar" }
function todayStr() { return new Date().toISOString().slice(0, 10); }
export default function TripsEditor() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState("");
  const [label, setLabel] = useState("");
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Inline edit of a manual trip's dates/label (no delete-and-re-add).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");
  const [eLabel, setELabel] = useState("");

  // A trip change moves the effective location, which feeds the brief + weather;
  // wipe the client caches and re-prime so those reflect it immediately (mirrors
  // the main prefs save).
  const reprimeDerived = () => {
    clientCache.clear();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dashboard-cache-cleared"));
  };

  const beginEdit = (t: TripRow) => { setEditingId(t.id); setEStart(t.startDate); setEEnd(t.endDate); setELabel(t.label); setErr(null); };
  const cancelEdit = () => { setEditingId(null); setErr(null); };
  const saveEdit = async (id: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/trips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, startDate: eStart, endDate: eEnd, label: eLabel.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d?.error || "Couldn't update the trip."); return; }
      setEditingId(null); reprimeDerived(); load();
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const load = () => {
    fetch("/api/trips")
      .then((r) => r.json())
      .then((d: { trips?: TripRow[]; active?: { id: string } | null }) => {
        setTrips(Array.isArray(d.trips) ? d.trips : []);
        setActiveId(d.active?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: location.trim(), label: label.trim(), startDate: start, endDate: end }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d?.error || "Couldn't add the trip."); return; }
      setLocation(""); setLabel("");
      reprimeDerived(); load();
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/trips?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setTrips((prev) => prev.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(null);
    if (editingId === id) setEditingId(null);
    reprimeDerived();
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        TDY / Travel <span className="text-slate-600 font-normal normal-case tracking-normal">· where you are now</span>
      </label>
      <p className="text-[10px] text-slate-600 mb-2 leading-relaxed">
        Add a trip with dates and the dashboard follows you — weather and the Morning Brief lead with wherever you are
        for the duration, then revert to home automatically. The location is geocoded (city + state/country works best).
      </p>

      {loading ? (
        <div className="h-9 bg-slate-900/60 border border-slate-800 rounded-md animate-pulse" />
      ) : (
        <>
          {trips.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {trips.map((t) => {
                const isCalendar = t.source === "calendar";
                if (editingId === t.id) {
                  return (
                    <li key={t.id} className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-2 space-y-2">
                      <input
                        value={eLabel}
                        onChange={(e) => setELabel(e.target.value)}
                        placeholder="Label"
                        className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-[10px] font-mono text-slate-500">From</label>
                        <input type="date" value={eStart} onChange={(e) => setEStart(e.target.value)} className="bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-600" />
                        <label className="text-[10px] font-mono text-slate-500">to</label>
                        <input type="date" value={eEnd} onChange={(e) => setEEnd(e.target.value)} className="bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-600" />
                        <div className="ml-auto flex items-center gap-1.5">
                          <button type="button" onClick={() => saveEdit(t.id)} disabled={busy} className="px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40 transition-all">{busy ? "Saving…" : "Save"}</button>
                          <button type="button" onClick={cancelEdit} className="text-[11px] text-slate-500 hover:text-slate-300 px-1">Cancel</button>
                        </div>
                      </div>
                      {err && <p className="text-[10px] text-red-400 leading-snug">{err}</p>}
                    </li>
                  );
                }
                return (
                  <li key={t.id} className={`flex items-center gap-2 text-[11px] rounded-md border px-2.5 py-1.5 ${t.id === activeId ? "bg-sky-500/10 border-sky-500/40" : "bg-slate-900/60 border-slate-800"}`}>
                    {t.id === activeId && <span className="text-[9px] font-bold uppercase tracking-wider text-sky-300 flex-shrink-0">● here now</span>}
                    <span className="text-slate-200 font-medium truncate">{t.label}</span>
                    <span className="text-slate-600 font-mono flex-shrink-0">{t.startDate}→{t.endDate}</span>
                    {isCalendar
                      ? <span className="text-[9px] font-mono text-slate-500 flex-shrink-0" title="Synced from a calendar event — edit the event's dates to change this">📅 calendar</span>
                      : <span className="text-[9px] font-mono text-slate-500 flex-shrink-0">{t.feedKey ? `news: ${t.feedKey}` : "news: geo"}</span>}
                    <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                      {!isCalendar && (
                        <button type="button" onClick={() => beginEdit(t)} className="text-slate-600 hover:text-sky-300" title="Edit dates / label">✎</button>
                      )}
                      <button type="button" onClick={() => remove(t.id)} className="text-slate-600 hover:text-red-400" title={isCalendar ? "Remove (re-syncs unless you change the calendar event)" : "Delete trip"}>✕</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-2">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (e.g. Stuttgart, Germany)"
              className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600"
            />
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-mono text-slate-500">From</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-600" />
              <label className="text-[10px] font-mono text-slate-500">to</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="bg-slate-900/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-600" />
              <button
                type="button"
                onClick={add}
                disabled={busy || !location.trim()}
                className="ml-auto px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {busy ? "Adding…" : "Add trip"}
              </button>
            </div>
            {err && <p className="text-[10px] text-red-400 leading-snug">{err}</p>}
          </div>
        </>
      )}
    </div>
  );
}
