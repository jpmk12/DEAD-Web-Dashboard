"use client";

import { useCallback, useEffect, useState } from "react";
import { COCOM_LABEL } from "@/lib/aor";
import { toast } from "@/lib/feedback";
import { announceTrackingChanged, openTrackPicker } from "@/lib/trackClient";
import type { TrackingRegistry, AirfieldRecord, CountryRecord, TrackRoles } from "@/lib/trackingRegistry";

// Preferences → Mission → "What you track" — ONE view of every tracking list
// (REVIEW-2026-10 §7). Replaces the three drawer editors (Force posture,
// Countries, METAR stations) that each held a stale copy of one list. Rows
// come from /api/track (the registry); every toggle is one POST through the
// same planner the picker uses, so AUTO removals record their exclusion and
// the Excluded fold can restore them. Crew see it read-only.

type Reg = TrackingRegistry;

const ROLE_KEYS: (keyof TrackRoles)[] = ["posture", "metar", "sitrep", "star"];
const ROLE_SHORT: Record<keyof TrackRoles, string> = { posture: "posture", metar: "METAR", sitrep: "SITREP", star: "★" };

export default function TrackingPanel() {
  const [reg, setReg] = useState<Reg | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showPlaces, setShowPlaces] = useState(false);

  const load = useCallback(() => {
    fetch("/api/track").then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))
      .then(({ ok, d }) => { if (ok && d?.registry) { setReg(d.registry); setCanEdit(!!d.canEdit); setErr(null); } else setErr(d?.error || "Could not load the registry"); })
      .catch(() => setErr("Could not load the registry"));
  }, []);

  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener("tracking:changed", on);
    window.addEventListener("force-locations:changed", on);
    return () => { window.removeEventListener("tracking:changed", on); window.removeEventListener("force-locations:changed", on); };
  }, [load]);

  const post = async (key: string, body: Record<string, unknown>) => {
    if (!canEdit) { toast.info("Tracking is team config — the owner changes it"); return; }
    setBusy(key);
    try {
      const r = await fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error("Could not change tracking", d?.error || `HTTP ${r.status}`); return; }
      if (d.registry) setReg(d.registry);
      if (d.changes?.length) { announceTrackingChanged(); toast.ok(d.changes.join(" · "), d.warnings?.length ? d.warnings.join(" · ") : undefined); }
      else if (d.warnings?.length) toast.warn(d.warnings.join(" · "));
    } catch (e) { toast.error("Could not change tracking", e); }
    finally { setBusy(null); }
  };

  const toggleAirfieldRole = (a: AirfieldRecord, k: keyof TrackRoles) =>
    post(`${a.key}:${k}`, { op: "track", kind: "airfield", icao: a.icao, label: a.label, lat: a.lat || undefined, lon: a.lon || undefined, country: a.country, roles: { [k]: !a.roles[k] } });
  const untrackAirfield = (a: AirfieldRecord) =>
    post(`${a.key}:all`, { op: "track", kind: "airfield", icao: a.icao, label: a.label, lat: a.lat || undefined, lon: a.lon || undefined, country: a.country, roles: { posture: false, metar: false, sitrep: false, star: false } });
  const toggleCountryRole = (c: CountryRecord, k: "posture" | "star") =>
    post(`${c.country}:${k}`, { op: "track", kind: "country", country: c.country, roles: { [k]: !c.roles[k] } });
  const untrackCountry = (c: CountryRecord) =>
    post(`${c.country}:all`, { op: "track", kind: "country", country: c.country, roles: { posture: false, star: false } });
  const removePlace = (p: { label: string; lat: number; lon: number }) =>
    post(`place:${p.label}`, { op: "track", kind: "place", label: p.label, lat: p.lat, lon: p.lon, remove: true });
  const restore = (id: string) => post(`restore:${id}`, { op: "restore", id });

  const chip = (on: boolean, label: string, title: string, onClick: () => void, key: string) => (
    <button key={key} type="button" title={title} disabled={!canEdit || busy === key} onClick={onClick}
      className={`text-[9px] font-mono px-1.5 py-px rounded border transition-colors disabled:opacity-50 ${on ? (label === "★" ? "border-amber-500/50 text-amber-300 bg-amber-500/10" : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10") : "border-slate-800 text-slate-600 hover:text-slate-300 hover:border-slate-600"}`}>
      {label}
    </button>
  );

  return (
    <div className="border border-slate-800 rounded-lg p-3 space-y-3 bg-slate-950/40 mb-4">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">What you track</label>
          <p className="text-[10px] text-slate-600 mt-0.5">
            {reg ? reg.summary : err ? err : "Loading…"} — one list, every role. Each airfield can carry posture (map + board), METAR/TAF (Weather tab), a SITREP slot, and ★. <span className="text-emerald-400 font-mono">AUTO</span> rows came from the Mission Profile; removing one records an exclusion so Apply does not bring it back.
            {!canEdit && reg && <span className="text-amber-400"> Shared team config — the owner edits.</span>}
          </p>
        </div>
        <button type="button" onClick={() => openTrackPicker()} disabled={!canEdit}
          className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40 flex-shrink-0">
          ＋ Track…
        </button>
      </div>

      {reg && (
        <>
          {/* Airfields */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1">Airfields · {reg.counts.airfields} <span className="text-slate-500 normal-case tracking-normal">({reg.counts.sitrep} SITREP{reg.counts.starIcaos ? ` · ${reg.counts.starIcaos} ★` : ""})</span></p>
            {reg.airfields.length === 0 && <p className="text-[11px] text-slate-600">No airfield tracked. Declare a hub in the Mission Profile below, or ＋ Track one.</p>}
            <ul className="divide-y divide-slate-800/70">
              {reg.airfields.map((a) => (
                <li key={a.key} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                    {a.icao ? <span className="text-[11px] font-mono font-bold text-slate-100">{a.icao}</span> : <span className="text-[9px] text-slate-600">no ICAO</span>}
                    <span className="text-[11px] text-slate-300 truncate max-w-[220px]">{a.label}</span>
                    {a.own && <span className="text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{a.own}</span>}
                    {a.auto && <span className="text-[8px] font-mono font-bold text-emerald-400/80 bg-emerald-500/10 rounded px-1">AUTO</span>}
                    <span className="text-[9px] text-slate-600 truncate">{[a.country, a.aor !== "UNKNOWN" ? COCOM_LABEL[a.aor] : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {ROLE_KEYS.map((k) => (!a.icao && k !== "posture") ? null : chip(a.roles[k], ROLE_SHORT[k], `${a.roles[k] ? "Remove" : "Add"} ${k}`, () => toggleAirfieldRole(a, k), `${a.key}:${k}`))}
                    <button type="button" disabled={!canEdit || busy === `${a.key}:all`} onClick={() => untrackAirfield(a)} title="Untrack everywhere" className="text-slate-600 hover:text-red-400 text-xs px-1 disabled:opacity-40" aria-label={`Untrack ${a.icao || a.label}`}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Countries */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1">Countries · {reg.counts.countries}{reg.counts.starCountries ? <span className="text-slate-500 normal-case tracking-normal"> ({reg.counts.starCountries} ★)</span> : null}</p>
            {reg.countries.length === 0 && <p className="text-[11px] text-slate-600">No country in the posture watch. Declare an AOI below, or ＋ Track one.</p>}
            <ul className="divide-y divide-slate-800/70">
              {reg.countries.map((c) => (
                <li key={c.country} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-100">{c.country}</span>
                    {c.auto && <span className="text-[8px] font-mono font-bold text-emerald-400/80 bg-emerald-500/10 rounded px-1">AUTO</span>}
                    {!c.roles.posture && <span className="text-[8px] font-mono text-amber-300/80">★ only — posture UNKNOWN</span>}
                    <span className="text-[9px] text-slate-600 truncate">{[c.aor !== "UNKNOWN" ? COCOM_LABEL[c.aor] : null, c.aoi ? `${c.aoi} AOI` : c.note].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {chip(c.roles.posture, "posture", c.roles.posture ? "Remove from the posture watch" : "Add to the posture watch", () => toggleCountryRole(c, "posture"), `${c.country}:posture`)}
                    {chip(c.roles.star, "★", c.roles.star ? "Remove ★" : "★ must-track", () => toggleCountryRole(c, "star"), `${c.country}:star`)}
                    <button type="button" disabled={!canEdit || busy === `${c.country}:all`} onClick={() => untrackCountry(c)} title="Untrack everywhere" className="text-slate-600 hover:text-red-400 text-xs px-1 disabled:opacity-40" aria-label={`Untrack ${c.country}`}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Places */}
          {reg.places.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowPlaces((v) => !v)} className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-300">{showPlaces ? "▾" : "▸"} Civil weather places · {reg.places.length}</button>
              {showPlaces && (
                <ul className="divide-y divide-slate-800/70 mt-1">
                  {reg.places.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1">
                      <span className="text-[11px] text-slate-300 flex-1 truncate">📍 {p.label} <span className="text-[9px] font-mono text-slate-600">{p.lat.toFixed(2)}, {p.lon.toFixed(2)}</span></span>
                      <button type="button" disabled={!canEdit || busy === `place:${p.label}`} onClick={() => removePlace(p)} className="text-slate-600 hover:text-red-400 text-xs px-1 disabled:opacity-40" aria-label={`Remove ${p.label}`}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Excluded */}
          {reg.excluded.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowExcluded((v) => !v)} className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-300">{showExcluded ? "▾" : "▸"} Excluded from Apply · {reg.excluded.length}</button>
              {showExcluded && (
                <ul className="divide-y divide-slate-800/70 mt-1">
                  {reg.excluded.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 py-1">
                      <span className="text-[11px] text-slate-400 flex-1 truncate line-through decoration-slate-700">{e.label}</span>
                      <span className="text-[8px] font-mono text-slate-600">{e.kind}</span>
                      <button type="button" disabled={!canEdit || busy === `restore:${e.id}`} onClick={() => restore(e.id)} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300 border border-slate-700 rounded px-1.5 py-px disabled:opacity-40">Restore</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
