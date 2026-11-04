"use client";

import { useState } from "react";
import { LOCAL_FEED_OPTIONS } from "./prefsOptions";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

// ─── Tracked locations editor (Weather tab) ──────────────────────────────────

// Parse a coordinate the lenient way users actually type them. Handles:
//   • decimal degrees ........ 34.6679 · -99.2677 · 34.6679° N · 34,6679 (EU)
//   • deg-min-sec (DMS) ...... 34°40′05″N · 99 16 04 W · 34d40m05sW
//   • deg-decimal-min ........ 34°40.083′N
// Any N/S/E/W letter wins over a typed minus sign (e.g. "26.3S" -> -26.3).
// Returns null only when there's no number to read.
function parseCoordInput(raw: string): number | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  const dir = s.match(/[NSEW]/);
  const negSign = /^\s*-/.test(raw);
  // Pull the numeric runs in order: degrees [, minutes [, seconds]]. A comma is
  // treated as a decimal separator before extracting (so "34,6679" -> "34.6679").
  const nums = (s.replace(",", ".").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length === 0) return null;
  const deg = (nums[0] ?? 0) + (nums[1] ?? 0) / 60 + (nums[2] ?? 0) / 3600;
  const sign = dir ? (dir[0] === "S" || dir[0] === "W" ? -1 : 1) : negSign ? -1 : 1;
  return sign * deg;
}

interface GeoResult { lat: number; lon: number; displayName: string; country?: string }

// Precise home-location picker. Home coords (localLat/localLon) drive the Weather
// tab, the Morning Brief's home forecast, and the map center. A non-empty `city`
// (the display label) marks a custom home; empty falls back to the local-news
// region preset's coords. Uses the same geocoder + coord parsing as the tracked-
// locations editor.
export default function HomeLocationEditor({
  feedKey, city, lat, lon, onSetCustom, onClearCustom,
}: {
  feedKey: string;
  city: string;
  lat: number | null;
  lon: number | null;
  onSetCustom: (label: string, lat: number, lon: number) => void;
  onClearCustom: () => void;
}) {
  const [geoQuery, setGeoQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [geoBusy, setGeoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [mLat, setMLat] = useState("");
  const [mLon, setMLon] = useState("");
  const [mLabel, setMLabel] = useState("");

  const isCustom = !!city.trim();
  const regionOpt = LOCAL_FEED_OPTIONS.find((o) => o.value === feedKey);
  const homeLabel = isCustom ? city : (regionOpt?.label ?? "—");
  const homeLat = lat ?? regionOpt?.lat ?? null;
  const homeLon = lon ?? regionOpt?.lon ?? null;

  const search = async () => {
    const q = geoQuery.trim();
    if (q.length < 2) return;
    setGeoBusy(true); setError(null); setGeoResults([]);
    try {
      const res = await fetch(`/api/osint/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      const results: GeoResult[] = Array.isArray(data?.results) ? data.results : [];
      setGeoResults(results);
      if (results.length === 0) setError("No match found. Try a city, full address, or ZIP/postal code.");
    } catch {
      setError("Place lookup failed — check your connection, or enter coordinates manually.");
    } finally {
      setGeoBusy(false);
    }
  };

  const pick = (r: GeoResult) => {
    const lbl = r.displayName.split(",").slice(0, 3).join(",").trim().slice(0, 80) || "Home";
    onSetCustom(lbl, r.lat, r.lon);
    setGeoResults([]); setGeoQuery(""); setError(null);
  };

  const addManual = () => {
    const la = parseCoordInput(mLat);
    const lo = parseCoordInput(mLon);
    if (la === null || lo === null) { setError("Enter coordinates as decimal (38.85, -104.80) or DMS (38°51′N), or use the search above."); return; }
    if (Math.abs(la) > 90) { setError(`Latitude must be between -90 and 90 (got ${la.toFixed(4)}). Did you swap lat and lon?`); return; }
    if (Math.abs(lo) > 180) { setError(`Longitude must be between -180 and 180 (got ${lo.toFixed(4)}).`); return; }
    onSetCustom(mLabel.trim().slice(0, 80) || "Home", la, lo);
    setMLat(""); setMLon(""); setMLabel(""); setShowManual(false); setError(null);
  };

  return (
    <div>
      {/* Active home readout */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-300 border-emerald-500/40 text-[10px] font-bold uppercase tracking-wider">
          🏠 Home
        </span>
        <span className="text-[11px] text-slate-200 font-medium">{homeLabel}</span>
        {homeLat != null && homeLon != null && (
          <span className="text-[10px] text-slate-600 font-mono">{homeLat.toFixed(2)}, {homeLon.toFixed(2)}</span>
        )}
        <span className="text-[9px] uppercase tracking-wider text-slate-600">{isCustom ? "· custom" : "· from region"}</span>
        {isCustom && (
          <button
            onClick={onClearCustom}
            className="text-[9px] uppercase tracking-wider text-slate-500 hover:text-red-400 transition-colors"
            title="Revert home to the local-news region's default location"
          >
            use region default
          </button>
        )}
      </div>

      {/* Geocode search */}
      <div className="flex gap-1.5">
        <input
          value={geoQuery}
          onChange={(e) => { setGeoQuery(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
          placeholder="Search home address, city, or ZIP…"
          className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <button
          onClick={search}
          disabled={geoBusy || geoQuery.trim().length < 2}
          className="text-[11px] font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40"
        >
          {geoBusy ? "…" : "Find"}
        </button>
      </div>

      {geoResults.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {geoResults.map((r, i) => (
            <li key={i}>
              <button
                onClick={() => pick(r)}
                title="Set as home"
                className="w-full text-left flex items-center gap-2 bg-slate-800/40 hover:bg-emerald-500/10 border border-slate-700/60 hover:border-emerald-500/40 rounded-md px-2.5 py-1.5 transition-colors group"
              >
                <span className="text-sm leading-none flex-shrink-0">🏠</span>
                <span className="text-xs text-slate-200 flex-1 min-w-0 truncate">{r.displayName}</span>
                <span className="text-[10px] text-slate-500 group-hover:text-emerald-400/80 font-mono flex-shrink-0">{r.lat.toFixed(2)}, {r.lon.toFixed(2)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Manual coordinate entry (collapsed) */}
      <button
        onClick={() => setShowManual((v) => !v)}
        className="text-[10px] text-slate-600 hover:text-slate-400 mt-2 transition-colors"
      >
        {showManual ? "▾" : "▸"} or enter coordinates manually
      </button>
      {showManual && (
        <div className="mt-1.5 space-y-1.5">
          <input
            value={mLabel} onChange={(e) => { setMLabel(e.target.value); setError(null); }}
            placeholder="Label (e.g. Home)"
            className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
          />
          <div className="flex gap-1.5">
            <input
              value={mLat} onChange={(e) => { setMLat(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
              placeholder="Lat (38.85)"
              className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
            />
            <input
              value={mLon} onChange={(e) => { setMLon(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
              placeholder="Lon (-104.80)"
              className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
            />
            <button
              onClick={addManual}
              className="text-[11px] font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider"
            >
              Set
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[10px] text-red-400 mt-1.5">{error}</p>}
    </div>
  );
}
