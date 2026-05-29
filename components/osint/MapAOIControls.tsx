"use client";

import { KeyboardEvent, useEffect, useState } from "react";

interface MapAOIControlsProps {
  // Current radius (km) — keeps the input in sync with whatever the map is
  // actively searching for, including after a "🔍 Search this area" click.
  currentRadiusKm: number;
  // Called when the user clicks Set or presses Enter. Lat/lon are absolute,
  // radiusKm is bounded 20-500 (the limits the proxy endpoints enforce).
  onApply: (lat: number, lon: number, radiusKm: number) => void;
  // Snap back to the configured home location.
  onReset: () => void;
}

// Always-visible area-of-interest controls shown above the map. Two input
// paths:
//   1. lat,lon — parsed directly (no network round-trip)
//   2. place name — geocoded via /api/osint/geocode (Nominatim proxy)
//
// Enter on either input submits. The Set button is the explicit click path.
// The Home button is the snap-back affordance and is intentionally always
// shown so the user has a one-click route back regardless of input state.
export default function MapAOIControls({ currentRadiusKm, onApply, onReset }: MapAOIControlsProps) {
  const [aoi, setAoi] = useState("");
  const [radius, setRadius] = useState(String(Math.round(currentRadiusKm)));
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // Keep the radius input in sync with the active search radius — so when
  // the user clicks "🔍 Search this area" (which uses the visible map
  // radius), the input box updates to match rather than carrying the old
  // value.
  useEffect(() => {
    setRadius(String(Math.round(currentRadiusKm)));
  }, [currentRadiusKm]);

  const parseRadius = (): number => {
    const n = parseFloat(radius);
    if (!Number.isFinite(n)) return currentRadiusKm;
    return Math.max(20, Math.min(500, n));
  };

  const submit = async () => {
    setError(null);
    setHint(null);
    const trimmed = aoi.trim();
    const r = parseRadius();

    // Empty input + just updated radius → apply the radius change in place.
    // The parent decides whether this means "re-fit map" or just "next poll
    // uses new radius" (current implementations re-search).
    if (!trimmed) {
      if (Math.abs(r - currentRadiusKm) > 0.5) {
        // We don't know the current center here, so just leave a hint —
        // the user needs to type a place or coords to actually move.
        setHint("Type a place or lat,lon to apply the new radius");
      }
      return;
    }

    // lat,lon pattern (e.g. "48.85,2.35" or "-33.86, 151.21").
    const m = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = parseFloat(m[1]);
      const lon = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        onApply(lat, lon, r);
        return;
      }
      setError("Coords out of range");
      return;
    }

    // Geocode anything else.
    setGeocoding(true);
    try {
      const res = await fetch(`/api/osint/geocode?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length === 0) {
        setError("No matches");
        return;
      }
      const top = results[0];
      onApply(top.lat, top.lon, r);
      // Replace the raw query with a short version of the matched name so
      // the user can see what we landed on.
      const short = String(top.displayName).split(",").slice(0, 2).join(", ").trim();
      setAoi(short);
    } catch {
      setError("Lookup failed");
    } finally {
      setGeocoding(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
      <span className="text-slate-600 font-mono uppercase tracking-wider shrink-0">AOI</span>
      <input
        type="text"
        value={aoi}
        onChange={(e) => setAoi(e.target.value)}
        onKeyDown={onKey}
        placeholder='City name or "lat,lon"'
        disabled={geocoding}
        className="flex-1 min-w-[180px] bg-slate-900 border border-slate-700 focus:border-emerald-500/40 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-700 outline-none transition-colors"
      />
      <input
        type="number"
        value={radius}
        onChange={(e) => setRadius(e.target.value)}
        onKeyDown={onKey}
        min={20}
        max={500}
        step={10}
        title="Radius (km, 20-500)"
        className="w-16 bg-slate-900 border border-slate-700 focus:border-emerald-500/40 rounded px-2 py-1 text-[11px] text-slate-200 outline-none font-mono text-right transition-colors"
      />
      <span className="text-slate-700 font-mono shrink-0">km</span>
      <button
        type="button"
        onClick={submit}
        disabled={geocoding}
        className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded font-bold uppercase tracking-wider transition-all disabled:opacity-40 shrink-0"
      >
        {geocoding ? "…" : "Set"}
      </button>
      <button
        type="button"
        onClick={() => { setAoi(""); setError(null); setHint(null); onReset(); }}
        title="Snap back to your home location"
        className="border border-slate-700 hover:border-slate-500 text-slate-500 hover:text-slate-300 px-2 py-1 rounded font-bold uppercase tracking-wider transition-all shrink-0"
      >
        ⌂ Home
      </button>
      {error && <span className="text-red-400 ml-1 shrink-0">⚠ {error}</span>}
      {hint && !error && <span className="text-slate-500 ml-1 shrink-0">{hint}</span>}
    </div>
  );
}
