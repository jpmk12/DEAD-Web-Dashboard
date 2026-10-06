"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COCOM_LABEL } from "@/lib/aor";
import { toast } from "@/lib/feedback";
import { announceTrackingChanged, type TrackPrefill } from "@/lib/trackClient";
import type { TrackRoles } from "@/lib/trackingRegistry";

// The ONE "track this" dialog (REVIEW-2026-10 §7). Opens on `track:open`
// (the ⌘K entry, the Preferences Tracking panel's ＋ Track…, and every Track
// button on a map popup / board row / situation room / Glance row), with an
// optional prefill so a tap on "Amman" lands already resolved. Type a name,
// an ICAO or a place; pick the candidate; tick the roles; done — one POST to
// /api/track, the server resolves coordinates, and the result panel names
// each list that changed with an Undo that reverses exactly that.
//
// Roles, in the app's words: posture = Force posture watch (the Crisis map
// dot, the board's posture column); METAR = aviation weather on the Weather
// tab; SITREP = one of the full-treatment slots; ★ = must-track (orders and
// pins; takes a SITREP slot). A country has posture + ★. A place is a civil
// weather point (forecast card) — never a base.

interface Candidate {
  kind: "airfield" | "country" | "place";
  icao?: string;
  label: string;
  lat?: number;
  lon?: number;
  country: string;
  aor?: string;
  roles: TrackRoles;
  own?: "hub" | "spoke" | null;
  tracked: boolean;
  source: string;
  /** place only: the geocoder's display name */
  displayName?: string;
}

interface Result { changes: string[]; warnings: string[]; undo: Record<string, unknown> | null }

const NONE: TrackRoles = { posture: false, metar: false, sitrep: false, star: false };

const ROLE_HELP: Record<keyof TrackRoles, string> = {
  posture: "Force posture watch — the map dot and the command board's posture column",
  metar: "METAR / TAF on the Weather tab (aviation weather, worldwide)",
  sitrep: "Full SITREP treatment — one of the limited slots (hub first)",
  star: "Must-track — orders and pins everywhere; takes a SITREP slot",
};

export default function TrackPicker() {
  const [open, setOpen] = useState(false);
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [cands, setCands] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<Candidate | null>(null);
  const [roles, setRoles] = useState<TrackRoles>(NONE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [placeTracked, setPlaceTracked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Search: airfields + countries from /api/track, places from the geocoder.
  const search = useCallback(async (q: string, want?: TrackPrefill) => {
    const my = ++seq.current;
    const t = q.trim();
    if (t.length < 2) { setCands([]); return; }
    setSearching(true);
    try {
      const [a, g] = await Promise.all([
        fetch(`/api/track?q=${encodeURIComponent(t)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        t.length >= 3 && want?.kind !== "airfield" && want?.kind !== "country"
          ? fetch(`/api/osint/geocode?q=${encodeURIComponent(t)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (my !== seq.current) return;
      const list: Candidate[] = [];
      for (const c of (a?.candidates ?? []) as Candidate[]) list.push(c);
      for (const r of (g?.results ?? []) as { lat: number; lon: number; displayName: string; country: string }[]) {
        list.push({ kind: "place", label: r.displayName.split(",")[0].trim().slice(0, 60), displayName: r.displayName, lat: r.lat, lon: r.lon, country: r.country, roles: NONE, tracked: false, source: "geocode" });
      }
      setCands(list);
      // A prefill that names the thing lands selected.
      if (want) {
        const hit = want.icao ? list.find((c) => c.kind === "airfield" && c.icao === want.icao!.toUpperCase())
          : want.country ? list.find((c) => c.kind === "country" && c.country.toLowerCase() === want.country!.toLowerCase())
          : null;
        if (hit) choose(hit);
      }
    } finally { if (my === seq.current) setSearching(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (c: Candidate) => {
    setSel(c);
    setResult(null);
    if (c.kind === "airfield") {
      // Defaults for an untracked field: posture + METAR (the two things every
      // base gets); SITREP and ★ are deliberate. A tracked field shows what it has.
      setRoles(c.tracked ? c.roles : { posture: true, metar: true, sitrep: false, star: false });
    } else if (c.kind === "country") {
      setRoles(c.tracked ? c.roles : { ...NONE, posture: true });
    }
  };

  // Open on demand.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const p = ((e as CustomEvent<TrackPrefill>).detail ?? {}) as TrackPrefill;
      setOpen(true); setResult(null); setSel(null); setPlaceTracked(false);
      if (canEdit == null) fetch("/api/track").then((r) => (r.ok ? r.json() : null)).then((d) => setCanEdit(!!d?.canEdit)).catch(() => setCanEdit(false));
      if (p.kind === "place" && typeof p.lat === "number" && typeof p.lon === "number") {
        const c: Candidate = { kind: "place", label: (p.label ?? "Place").slice(0, 60), displayName: p.label, lat: p.lat, lon: p.lon, country: p.country ?? "", roles: NONE, tracked: false, source: "prefill" };
        setQuery(p.label ?? ""); setCands([c]); choose(c);
        return;
      }
      const q = p.icao ?? p.country ?? p.query ?? "";
      setQuery(q);
      if (q) void search(q, p); else setCands([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    };
    window.addEventListener("track:open", onOpen);
    return () => window.removeEventListener("track:open", onOpen);
  }, [search, canEdit]);

  // Debounced typing.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(query), 260);
    return () => clearTimeout(t);
  }, [query, open, search]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const diff = useMemo(() => {
    if (!sel || sel.kind === "place") return {};
    const out: Partial<TrackRoles> = {};
    const keys: (keyof TrackRoles)[] = sel.kind === "airfield" ? ["posture", "metar", "sitrep", "star"] : ["posture", "star"];
    for (const k of keys) if (roles[k] !== sel.roles[k]) out[k] = roles[k];
    return out;
  }, [sel, roles]);

  const post = async (body: Record<string, unknown>): Promise<Result | null> => {
    setBusy(true);
    try {
      const r = await fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "track", ...body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error("Could not change tracking", d?.error || `HTTP ${r.status}`); return null; }
      if (Array.isArray(d.changes) && d.changes.length) announceTrackingChanged();
      return { changes: d.changes ?? [], warnings: d.warnings ?? [], undo: d.undo ?? null };
    } catch (e) {
      toast.error("Could not change tracking", e); return null;
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!sel) return;
    let body: Record<string, unknown>;
    if (sel.kind === "place") body = { kind: "place", label: sel.label, lat: sel.lat, lon: sel.lon, remove: placeTracked };
    else if (sel.kind === "country") body = { kind: "country", country: sel.country, roles: diff };
    else body = { kind: "airfield", icao: sel.icao, label: sel.label, lat: sel.lat, lon: sel.lon, country: sel.country, roles: diff };
    const res = await post(body);
    if (res) {
      setResult(res);
      // Reflect the new state on the selection so a second edit starts right.
      if (sel.kind !== "place") setSel({ ...sel, tracked: true, roles: { ...roles } });
      else setPlaceTracked(!placeTracked);
    }
  };

  const undo = async () => {
    if (!result?.undo) return;
    const res = await post(result.undo);
    if (res) {
      setResult({ ...res, undo: null });
      if (sel && sel.kind !== "place") { const r = (result.undo as { roles?: Partial<TrackRoles> }).roles ?? {}; const next = { ...roles, ...r }; setRoles(next); setSel({ ...sel, roles: next }); }
      toast.ok("Undone");
    }
  };

  if (!open) return null;
  const canSubmit = !!sel && !busy && canEdit !== false && (sel.kind === "place" || Object.keys(diff).length > 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/70 backdrop-blur-sm px-3 pt-[8vh]" onMouseDown={() => setOpen(false)}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden" role="dialog" aria-label="Track a country, airfield or place">
        <div className="px-4 pt-3 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">Track</span>
            <span className="text-[10px] text-slate-500">country · airfield (ICAO or name) · place</span>
            <button onClick={() => setOpen(false)} className="ml-auto text-slate-500 hover:text-slate-200 text-sm" aria-label="Close">✕</button>
          </div>
          <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSel(null); setResult(null); }}
            placeholder="Jordan · OJAQ · Al Udeid · Amman…" autoComplete="off" spellCheck={false}
            className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60" />
          {canEdit === false && <p className="mt-1.5 text-[10.5px] text-amber-300">Tracking is shared team config — the owner changes it. You can look; the buttons are off.</p>}
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {/* Candidates */}
          {!sel && (
            <ul className="divide-y divide-slate-800">
              {searching && cands.length === 0 && <li className="px-4 py-3 text-[11px] text-slate-500">Searching…</li>}
              {!searching && query.trim().length >= 2 && cands.length === 0 && <li className="px-4 py-3 text-[11px] text-slate-500">Nothing matched. Try the ICAO, the country name, or a city.</li>}
              {query.trim().length < 2 && <li className="px-4 py-3 text-[11px] text-slate-500">Type a country, an ICAO or airfield name, or a city for a civil weather point.</li>}
              {cands.map((c, i) => (
                <li key={`${c.kind}-${c.icao ?? c.label}-${i}`}>
                  <button onClick={() => choose(c)} className="w-full text-left px-4 py-2 hover:bg-slate-800/60 flex items-center gap-3">
                    <span className="text-base w-5 text-center">{c.kind === "airfield" ? "✈" : c.kind === "country" ? "🌐" : "📍"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-slate-100 truncate">
                        {c.kind === "airfield" && <span className="font-mono font-bold mr-1.5">{c.icao}</span>}{c.label}
                        {c.own && <span className="ml-1.5 text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{c.own}</span>}
                      </span>
                      <span className="block text-[10.5px] text-slate-500 truncate">
                        {c.kind === "place" ? c.displayName : [c.kind === "airfield" ? c.country : null, c.aor ? COCOM_LABEL[c.aor] : null].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 whitespace-nowrap">
                      {c.tracked ? ["posture", "metar", "sitrep", "star"].filter((k) => c.roles[k as keyof TrackRoles]).map((k) => (k === "star" ? "★" : k)).join(" · ") || "tracked" : "not tracked"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Roles */}
          {sel && (
            <div className="px-4 py-3 space-y-3">
              <button onClick={() => { setSel(null); setResult(null); }} className="text-[10px] text-slate-500 hover:text-slate-300">← candidates</button>
              <div className="flex items-center gap-2">
                <span className="text-base">{sel.kind === "airfield" ? "✈" : sel.kind === "country" ? "🌐" : "📍"}</span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-slate-100 truncate">{sel.kind === "airfield" && <span className="font-mono mr-1.5">{sel.icao}</span>}{sel.label}</p>
                  <p className="text-[10.5px] text-slate-500 truncate">{sel.kind === "place" ? sel.displayName : [sel.country, sel.aor ? COCOM_LABEL[sel.aor] : null].filter(Boolean).join(" · ")}{sel.own ? ` · own force (${sel.own})` : ""}</p>
                </div>
              </div>

              {sel.kind === "place" ? (
                <p className="text-[11px] text-slate-400">A civil weather point: a forecast card on the Weather tab and a marker on the map. Not a base — track an airfield for posture.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {((sel.kind === "airfield" ? ["posture", "metar", "sitrep", "star"] : ["posture", "star"]) as (keyof TrackRoles)[]).map((k) => (
                    <label key={k} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer ${roles[k] ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800 hover:border-slate-700"}`}>
                      <input type="checkbox" checked={roles[k]} disabled={canEdit === false} onChange={(e) => setRoles({ ...roles, [k]: e.target.checked })} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-[12px] text-slate-200">{k === "star" ? "★ must-track" : k === "metar" ? "METAR / TAF" : k === "sitrep" ? "SITREP slot" : "Force posture"}{sel.roles[k] !== roles[k] && <span className="ml-1.5 text-[9px] font-mono text-amber-300">{roles[k] ? "+ add" : "− remove"}</span>}</span>
                        <span className="block text-[10px] text-slate-500">{ROLE_HELP[k]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {result && (
                <div className={`rounded-lg border px-3 py-2 text-[11px] ${result.changes.length ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800"}`}>
                  {result.changes.map((c) => <p key={c} className="text-emerald-300">✓ {c}</p>)}
                  {result.warnings.map((w) => <p key={w} className="text-amber-300">⚠ {w}</p>)}
                  {!result.changes.length && !result.warnings.length && <p className="text-slate-400">Nothing changed.</p>}
                  {result.undo && <button onClick={undo} disabled={busy} className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white border border-slate-600 rounded px-2 py-0.5">↶ Undo</button>}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button onClick={submit} disabled={!canSubmit}
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40">
                  {busy ? "…" : sel.kind === "place" ? (placeTracked ? "Remove place" : "Track place") : Object.keys(diff).length ? "Apply" : "No change"}
                </button>
                <button onClick={() => setOpen(false)} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Done</button>
                <span className="text-[9.5px] text-slate-600 ml-auto">Esc closes</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
