"use client";

import { useEffect, useState, KeyboardEvent, type ReactElement } from "react";
import { useSession, signOut } from "next-auth/react";
import { UserPrefs, AppTheme, TrackedLocation, TickerEntry, OsintFeed, NewsletterSourceRule, MetarStation, AiFeature, AiUsageSummary } from "@/lib/types";
import { ALL_AI_FEATURES, AI_FEATURE_LABELS } from "@/lib/aiFeatures";
import { OSINT_FEED_SUGGESTIONS, type OsintFeedSuggestion } from "@/lib/osintSuggestions";
import { BASE_NEWS_SOURCES, LOCAL_NEWS_SETS, allKnownNewsSources, type NewsSource } from "@/lib/newsSources";
import { AMC_HUBS, type AmcHub } from "@/lib/amcHubs";
import { clientCache } from "@/lib/clientCache";
import { applyTheme } from "@/components/ThemeApplicator";

interface PreferencesDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function TagInput({
  label,
  description,
  tags,
  onChange,
  placeholder,
  accent = "emerald",
}: {
  label: string;
  description?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  accent?: "emerald" | "orange" | "red";
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInput("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !input && tags.length) onChange(tags.slice(0, -1));
  };

  const tagColors = {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    orange:  "bg-orange-500/15 text-orange-300 border-orange-500/30",
    red:     "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</label>
      {description && <p className="text-[10px] text-slate-600 mb-2">{description}</p>}
      <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-800/70 border border-slate-700/80 rounded-lg min-h-[44px] focus-within:border-slate-500 transition-colors">
        {tags.map((tag) => (
          <span key={tag} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${tagColors[accent]}`}>
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="opacity-60 hover:opacity-100 transition-opacity leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[100px] bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none"
        />
      </div>
      <p className="text-[10px] text-slate-700 mt-1">Enter or comma to add · Backspace to remove last</p>
    </div>
  );
}

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

interface GeoResult { lat: number; lon: number; displayName: string }

function TrackedLocationsEditor({ value, onChange, onAddMetar }: { value: TrackedLocation[]; onChange: (v: TrackedLocation[]) => void; onAddMetar?: (s: MetarStation) => void; }) {
  const [label, setLabel] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Place / ZIP search (geocoded via /api/osint/geocode → Nominatim).
  const [geoQuery, setGeoQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [geoBusy, setGeoBusy] = useState(false);
  // AMC hub quick-add (collapsed by default).
  const [hubsOpen, setHubsOpen] = useState(false);

  // A hub is "on the map" if a tracked location already sits on its coords.
  const hubOnMap = (h: AmcHub) => value.some((v) => Math.abs(v.lat - h.lat) < 0.05 && Math.abs(v.lon - h.lon) < 0.05);

  // One tap adds the hub as a tracked location (map + AOR threat board) AND
  // registers its ICAO for global METAR/TAF (the aviation weather that works
  // worldwide, unlike the US-only NWS forecast).
  const addHub = (h: AmcHub) => {
    onAddMetar?.({ icao: h.icao, label: h.name }); // parent dedupes by ICAO
    if (hubOnMap(h)) { setError(null); return; }
    if (value.length >= 10) {
      setError(`Added ${h.icao} aviation weather. Tracked-location map is full (10 max) — remove one to also pin this hub.`);
      return;
    }
    onChange([...value, { id: `${h.lat.toFixed(2)},${h.lon.toFixed(2)}-${Date.now()}`, label: h.name.slice(0, 60), lat: h.lat, lon: h.lon }]);
    setError(null);
  };

  const add = () => {
    if (value.length >= 10) { setError("Maximum of 10 tracked locations reached."); return; }
    if (!label.trim()) { setError("Enter a label for this location."); return; }
    const la = parseCoordInput(lat);
    const lo = parseCoordInput(lon);
    if (la === null || lo === null) { setError("Enter coordinates as decimal (34.67, -99.27) or DMS (34°40′05″N), or use the place search above."); return; }
    if (Math.abs(la) > 90) { setError(`Latitude must be between -90 and 90 (got ${la.toFixed(4)}). Did you swap lat and lon?`); return; }
    if (Math.abs(lo) > 180) { setError(`Longitude must be between -180 and 180 (got ${lo.toFixed(4)}).`); return; }
    onChange([...value, { id: `${la.toFixed(2)},${lo.toFixed(2)}-${Date.now()}`, label: label.trim().slice(0, 60), lat: la, lon: lo }]);
    setLabel(""); setLat(""); setLon(""); setError(null);
  };

  // Geocode a free-text place name, address, or ZIP/postal code. Clicking a
  // result adds it to the list immediately (one tap) — see addFromResult.
  const searchPlace = async () => {
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
      setError("Place lookup failed — check your connection, or enter coordinates manually below.");
    } finally {
      setGeoBusy(false);
    }
  };

  // Clicking a search result adds the location straight to the list (the list
  // is staged; the drawer's Save button persists it). No extra Add step.
  const addFromResult = (r: GeoResult) => {
    if (value.length >= 10) { setError("Maximum of 10 tracked locations reached."); return; }
    const lbl = r.displayName.split(",").slice(0, 2).join(",").trim().slice(0, 60) || "Location";
    onChange([...value, { id: `${r.lat.toFixed(2)},${r.lon.toFixed(2)}-${Date.now()}`, label: lbl, lat: r.lat, lon: r.lon }]);
    setGeoResults([]); setGeoQuery(""); setError(null);
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Tracked Locations
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Extra locations shown alongside your home on the Weather tab. Each gets a forecast card,
        active NWS alerts, and feeds the alerts aggregator. Up to 10. Search by place or ZIP, or
        enter coordinates (decimal or DMS) manually. (Your home base isn&apos;t in this list — it&apos;s
        the &quot;Local Area / Home&quot; setting under General.)
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {value.map((loc) => (
            <li key={loc.id} className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5">
              <span className="text-xs text-slate-200 flex-1 min-w-0 truncate">{loc.label}</span>
              <span className="text-[10px] text-slate-500 font-mono">{loc.lat.toFixed(2)}, {loc.lon.toFixed(2)}</span>
              <button
                onClick={() => onChange(value.filter((x) => x.id !== loc.id))}
                className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1"
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* AMC hub quick-add — adds the en route/staging base as a map location
          AND its ICAO for global METAR/TAF (works OCONUS where NWS doesn't). */}
      <button
        onClick={() => setHubsOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-300 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-500 rounded-md px-2.5 py-1.5 transition-all mb-2"
      >
        <span>✈ Add AMC hub</span>
        <span className="text-slate-500">{hubsOpen ? "▴" : "▾"}</span>
      </button>
      {hubsOpen && (
        <div className="mb-3 border border-slate-800 rounded-md p-2.5 bg-slate-900/40 max-h-60 overflow-y-auto">
          <p className="text-[10px] text-slate-600 mb-2 leading-snug">
            One tap pins the base on the map/threat board <span className="text-slate-500">and</span> adds its ICAO
            for global METAR/TAF — the aviation weather that works worldwide.
          </p>
          {AMC_HUBS.map(({ region, hubs }) => (
            <div key={region} className="mb-2 last:mb-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">{region}</p>
              <div className="flex flex-wrap gap-1">
                {hubs.map((h: AmcHub) => {
                  const on = hubOnMap(h);
                  return (
                    <button
                      key={h.icao}
                      onClick={() => addHub(h)}
                      title={on ? `${h.name} — already pinned · ${h.icao}` : `Add ${h.name} (${h.icao})`}
                      className={`text-[10px] px-2 py-1 rounded border font-mono transition-all touch-manipulation ${
                        on
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                          : "border-slate-700 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/10"
                      }`}
                    >
                      {on ? "✓ " : "+ "}{h.name.split(",")[0]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search by place name, address, or ZIP — geocodes to coordinates */}
      <div className="flex gap-1.5">
        <input
          value={geoQuery}
          onChange={(e) => { setGeoQuery(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchPlace(); } }}
          placeholder="Search city, address, or ZIP…"
          className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <button
          onClick={searchPlace}
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
                onClick={() => addFromResult(r)}
                title="Add this location"
                className="w-full text-left flex items-center gap-2 bg-slate-800/40 hover:bg-emerald-500/10 border border-slate-700/60 hover:border-emerald-500/40 rounded-md px-2.5 py-1.5 transition-colors group"
              >
                <span className="text-emerald-400 font-bold text-sm leading-none flex-shrink-0">+</span>
                <span className="text-xs text-slate-200 flex-1 min-w-0 truncate">{r.displayName}</span>
                <span className="text-[10px] text-slate-500 group-hover:text-emerald-400/80 font-mono flex-shrink-0">{r.lat.toFixed(2)}, {r.lon.toFixed(2)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-slate-700 mt-3 mb-1.5">…or add by coordinates manually:</p>
      <input
        value={label} onChange={(e) => { setLabel(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        placeholder="Label (e.g. Kadena AB)"
        className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 mb-1.5"
      />
      <div className="flex gap-1.5">
        <input
          value={lat} onChange={(e) => { setLat(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Lat"
          title="Decimal (34.6679) or DMS (34°40′05″N)"
          className="flex-1 min-w-0 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <input
          value={lon} onChange={(e) => { setLon(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Lon"
          title="Decimal (-99.2677) or DMS (99°16′04″W)"
          className="flex-1 min-w-0 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <button
          onClick={add}
          disabled={value.length >= 10}
          className="flex-shrink-0 text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-4 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

// ─── Markets watchlist editor (Markets tab) ──────────────────────────────────

function NewsletterSourcesEditor({ value, onChange }: { value: NewsletterSourceRule[]; onChange: (v: NewsletterSourceRule[]) => void; }) {
  const [label, setLabel] = useState("");
  const [matchType, setMatchType] = useState<NewsletterSourceRule["matchType"]>("sender");
  const [val, setVal] = useState("");

  const add = () => {
    const lab = label.trim().slice(0, 40);
    const v = val.trim().slice(0, 200);
    if (!lab || !v || value.length >= 12) return;
    const id = `nl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    onChange([...value, { id, label: lab, matchType, value: v, enabled: true }]);
    setLabel(""); setVal("");
  };
  const toggleEnabled = (id: string) =>
    onChange(value.map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r)));
  const remove = (id: string) => onChange(value.filter((r) => r.id !== id));

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Newsletter Sources
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Which emails feed the Newsletters panel. Match by{" "}
        <span className="text-emerald-400">sender</span> (email or domain, e.g.&nbsp;
        <code className="text-emerald-400">politico.com</code>) or by{" "}
        <span className="text-emerald-400">subject</span> phrase — useful when one sender blasts several
        newsletters. Up to 12.
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5 max-h-56 overflow-y-auto">
          {value.map((r) => {
            const off = r.enabled === false;
            return (
              <li key={r.id} className={`flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5 ${off ? "opacity-50" : ""}`}>
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 flex-shrink-0 w-14 text-center">
                  {r.matchType}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-200 truncate">{r.label}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">{r.value}</div>
                </div>
                <button
                  onClick={() => toggleEnabled(r.id)}
                  title={off ? "Disabled — click to enable" : "Enabled — click to disable"}
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors flex-shrink-0 ${off ? "text-slate-500 hover:text-emerald-400" : "text-emerald-400 hover:text-emerald-300"}`}
                >
                  {off ? "Off" : "On"}
                </button>
                <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1 flex-shrink-0">×</button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-1.5">
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value as NewsletterSourceRule["matchType"])}
          className="bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-slate-500"
        >
          <option value="sender">Sender</option>
          <option value="subject">Subject</option>
        </select>
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="w-24 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <input
          value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={matchType === "sender" ? "politico.com" : "Morning Defense"}
          className="flex-1 min-w-0 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <button
          onClick={add}
          disabled={!label.trim() || !val.trim() || value.length >= 12}
          className="text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function MetarStationsEditor({ value, onChange }: { value: MetarStation[]; onChange: (v: MetarStation[]) => void; }) {
  const [icao, setIcao] = useState("");
  const [label, setLabel] = useState("");
  const add = () => {
    const code = icao.trim().toUpperCase();
    const lab = label.trim().slice(0, 60) || code;
    if (!/^[A-Z0-9]{4}$/.test(code) || value.length >= 12) return;
    if (value.some((s) => s.icao === code)) return;
    onChange([...value, { icao: code, label: lab }]);
    setIcao(""); setLabel("");
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        METAR / TAF Stations
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Airfields shown with decoded aviation weather on the Weather tab. Use 4-letter ICAO codes
        (e.g.&nbsp;<code className="text-emerald-400">KCOS</code>, <code className="text-emerald-400">RODN</code>). Up to 12.
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5 max-h-56 overflow-y-auto">
          {value.map((s) => (
            <li key={s.icao} className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5">
              <span className="text-[10px] font-mono font-bold text-sky-400 flex-shrink-0 w-12">{s.icao}</span>
              <span className="text-xs text-slate-300 flex-1 min-w-0 truncate">{s.label}</span>
              <button
                onClick={() => onChange(value.filter((x) => x.icao !== s.icao))}
                className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          value={icao} onChange={(e) => setIcao(e.target.value.toUpperCase().slice(0, 4))}
          placeholder="ICAO"
          className="w-20 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Display name (e.g. Ramstein AB)"
          className="flex-1 min-w-0 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <button
          onClick={add}
          disabled={!/^[A-Z0-9]{4}$/.test(icao.trim().toUpperCase()) || value.length >= 12}
          className="text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function MarketsWatchlistEditor({ value, onChange }: { value: TickerEntry[]; onChange: (v: TickerEntry[]) => void; }) {
  const [symbol, setSymbol] = useState("");
  const [label, setLabel] = useState("");
  const add = () => {
    const sym = symbol.trim().toUpperCase();
    const lab = label.trim().slice(0, 60);
    if (!sym || !lab) return;
    if (!/^[A-Z0-9:_!.\-]{1,32}$/.test(sym)) return;
    if (value.some((e) => e.symbol === sym)) return;
    onChange([...value, { symbol: sym, label: lab }]);
    setSymbol(""); setLabel("");
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Markets Watchlist
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        TradingView symbols shown on the Markets tab. Format: <code className="text-emerald-400">EXCHANGE:TICKER</code> (e.g.&nbsp;
        <code className="text-emerald-400">NYSE:LMT</code>, <code className="text-emerald-400">NYMEX:CL1!</code>,
        <code className="text-emerald-400">FX:USDJPY</code>). Up to 30.
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5 max-h-48 overflow-y-auto">
          {value.map((t) => (
            <li key={t.symbol} className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5">
              <span className="text-[10px] font-mono text-emerald-400 flex-shrink-0">{t.symbol}</span>
              <span className="text-xs text-slate-300 flex-1 min-w-0 truncate">{t.label}</span>
              <button
                onClick={() => onChange(value.filter((x) => x.symbol !== t.symbol))}
                className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="NYSE:KTOS"
          className="w-32 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Display name"
          className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <button
          onClick={add}
          disabled={!symbol.trim() || !label.trim() || value.length >= 30}
          className="text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── OSINT feeds editor ──────────────────────────────────────────────────────

interface OsintFeedHealth { id: string; count: number; fetchedAt: number; ok: boolean }

interface DiagnosticResult {
  ok: boolean;
  url: string;
  status?: number;
  statusText?: string;
  contentType?: string;
  bytes?: number;
  itemTagCount?: number;
  entryTagCount?: number;
  parsedItems?: number;
  firstTitle?: string;
  durationMs: number;
  error?: string;
  hint?: string;
  alternatives?: string[];
}

// Inline diagnostic panel. Renders the test-feed result in a compact form
// suitable for tucking under a feed row or the add-form. Colour-codes the
// status badge; surfaces the bridge-specific hint prominently when present;
// offers one-click alternative-instance swaps when the diagnostic returns
// alternatives. The optional onSwapTo callback wires the swap to the parent
// (used for existing-feed rows; the add-form passes onSwapTo as a setter
// that fills the URL input instead).
function TestResultPanel({ r, onClose, onSwapTo }: { r: DiagnosticResult; onClose: () => void; onSwapTo?: (newUrl: string) => void }) {
  const passed = r.ok;
  const statusColor = passed
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
    : r.status && r.status >= 200 && r.status < 300
    ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
    : "bg-red-500/15 text-red-300 border-red-500/40";
  return (
    <div className="mt-1.5 bg-slate-900/80 border border-slate-700/60 rounded-md px-2.5 py-2 text-[10px]">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusColor}`}>
          {r.error ? "ERR" : r.status ? `HTTP ${r.status}` : "—"}
        </span>
        <span className="text-slate-500 font-mono">{r.durationMs} ms</span>
        {r.contentType && <span className="text-slate-600 font-mono truncate flex-1">{r.contentType}</span>}
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 leading-none">×</button>
      </div>
      {r.error ? (
        <p className="text-red-400 font-mono">{r.error}</p>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-slate-400 font-mono">
          <span><span className="text-slate-600">Bytes:</span> {r.bytes?.toLocaleString() ?? "—"}</span>
          <span><span className="text-slate-600">&lt;item&gt;:</span> {r.itemTagCount ?? 0}</span>
          <span><span className="text-slate-600">&lt;entry&gt;:</span> {r.entryTagCount ?? 0}</span>
        </div>
      )}
      {r.firstTitle && (
        <p className="mt-1.5 text-slate-300 truncate" title={r.firstTitle}>
          <span className="text-slate-600">Top:</span> {r.firstTitle}
        </p>
      )}
      {r.hint && (
        <p className="mt-1.5 text-amber-300/90 leading-snug border-t border-slate-800 pt-1.5">
          💡 {r.hint}
        </p>
      )}
      {r.alternatives && r.alternatives.length > 0 && onSwapTo && (
        <div className="mt-1.5 border-t border-slate-800 pt-1.5">
          <p className="text-slate-500 font-mono mb-1 text-[9px] uppercase tracking-wider">
            Try a different instance:
          </p>
          <div className="space-y-1">
            {r.alternatives.map((altUrl) => {
              let altHost = altUrl;
              try { altHost = new URL(altUrl).hostname; } catch { /* keep full URL */ }
              return (
                <div key={altUrl} className="flex items-center gap-1.5">
                  <code className="text-[10px] text-emerald-400 font-mono truncate flex-1" title={altUrl}>
                    {altHost}
                  </code>
                  <button
                    type="button"
                    onClick={() => onSwapTo(altUrl)}
                    className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded transition-all flex-shrink-0"
                  >
                    Use this
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-slate-600 font-mono mt-1.5 text-[9px] leading-snug">
            Still failing? Self-hosting RSSHub is the durable fix —{" "}
            <a
              href="https://docs.rsshub.app/install/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 underline hover:text-emerald-400"
            >
              docs.rsshub.app/install
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

// Toggle list for the News tab's RSS sources. Backed by lib/newsSources.ts —
// disabling a source skips the fetch entirely in /api/news, so token cost for
// news_chat / threads / briefing drops along with bandwidth.
//
// Pref shape: `disabledNewsSources` is a list of source NAMES (opt-out).
// Missing-from-list = enabled, so future sources I add default-on.
//
// localFeedKey context: the user's current local set is highlighted with a
// tiny "current local" hint; other local-set sources show greyed so the user
// knows they're not active right now, but they're still toggleable so the
// pref survives a location switch.
interface NewsSourceStat { name: string; count: number; totalChars: number }

function NewsSourcesEditor({
  value,
  onChange,
  currentLocalKey,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  currentLocalKey: string;
}) {
  const sources = allKnownNewsSources();
  const disabledSet = new Set(value);
  const currentLocalSet = new Set((LOCAL_NEWS_SETS[currentLocalKey] ?? []).map((s) => s.name));
  const baseNames = new Set(BASE_NEWS_SOURCES.map((s) => s.name));
  const [stats, setStats] = useState<Map<string, NewsSourceStat>>(new Map());
  const [statsLoading, setStatsLoading] = useState(true);

  // Pull /api/news once on mount for the per-source volume counts shown
  // beside each toggle. The route already fetches every feed for the News
  // tab, so we're sharing whatever caching the platform layer provides.
  useEffect(() => {
    setStatsLoading(true);
    fetch("/api/news")
      .then((r) => r.json())
      .then((d) => {
        const arr: NewsSourceStat[] = Array.isArray(d?.sourceStats) ? d.sourceStats : [];
        const map = new Map<string, NewsSourceStat>();
        for (const s of arr) map.set(s.name, s);
        setStats(map);
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  // Items / token estimate formatting. Token guess = chars / 4 — close
  // enough for English news prose. We surface "items" prominently and
  // tokens as a secondary indicator. The exact saving depends on whether
  // total volume drops below each AI route's article cap.
  const formatTokens = (chars: number): string => {
    const tok = Math.round(chars / 4);
    if (tok >= 10_000) return `${Math.round(tok / 1000)}k tok`;
    if (tok >= 1000)   return `${(tok / 1000).toFixed(1)}k tok`;
    return `${tok} tok`;
  };

  // Sum the enabled stats so the user sees the impact of their current
  // disabled set on aggregate volume.
  const aggregate = (() => {
    let items = 0;
    let chars = 0;
    let itemsIfAll = 0;
    let charsIfAll = 0;
    for (const s of sources) {
      const hit = stats.get(s.name);
      if (!hit) continue;
      itemsIfAll += hit.count;
      charsIfAll += hit.totalChars;
      if (!disabledSet.has(s.name)) {
        items += hit.count;
        chars += hit.totalChars;
      }
    }
    return { items, chars, itemsIfAll, charsIfAll };
  })();

  // Group by category for visual structure. Categories render in a stable
  // order; local goes last since it's location-dependent.
  const CATEGORY_ORDER: NewsSource["category"][] = ["overview", "defense", "strategic", "domestic", "space", "local"];
  const grouped = new Map<NewsSource["category"], NewsSource[]>();
  for (const s of sources) {
    const arr = grouped.get(s.category) ?? [];
    arr.push(s);
    grouped.set(s.category, arr);
  }

  const CATEGORY_LABEL: Record<NewsSource["category"], string> = {
    overview: "Overview",
    defense: "Defense",
    strategic: "Strategic",
    domestic: "Domestic",
    space: "Space",
    local: "Local",
  };
  const CATEGORY_COLOR: Record<NewsSource["category"], string> = {
    overview:  "bg-slate-700/40 text-slate-300 border-slate-600",
    defense:   "bg-red-500/15 text-red-300 border-red-500/40",
    strategic: "bg-violet-500/15 text-violet-300 border-violet-500/40",
    domestic:  "bg-amber-500/15 text-amber-300 border-amber-500/40",
    space:     "bg-sky-500/15 text-sky-300 border-sky-500/40",
    local:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  };

  const toggle = (name: string) => {
    const next = new Set(disabledSet);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(Array.from(next));
  };
  const enableAll  = () => onChange([]);
  const disableAll = () => onChange(sources.map((s) => s.name));

  const enabledCount = sources.length - value.length;

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        News Sources
      </label>
      <p className="text-[10px] text-slate-600 mb-2 leading-relaxed">
        Toggle individual feeds off to cut both the read pile AND the token cost of
        News chat / threads / briefing — disabled sources are skipped before fetch.
        Each row shows <span className="text-slate-400">items</span> in the last
        fetch and the rough <span className="text-slate-400">tokens</span> they
        carry if all were sent to Claude. Real savings only kick in once volume
        drops below the route caps (chat: 20, threads / news-chat: 40).
      </p>
      <div className="flex items-center gap-2 mb-3 text-[10px]">
        <span className="text-slate-500 font-mono">{enabledCount}/{sources.length} enabled</span>
        {!statsLoading && aggregate.itemsIfAll > 0 && (
          <span className="text-slate-600 font-mono">
            · {aggregate.items}/{aggregate.itemsIfAll} items
            {" · "}
            <span className={aggregate.chars < aggregate.charsIfAll ? "text-emerald-400" : ""}>
              ~{formatTokens(aggregate.chars)}
            </span>
            {" / "}
            ~{formatTokens(aggregate.charsIfAll)}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={enableAll}
          className="font-bold uppercase tracking-wider border border-slate-700 hover:border-emerald-500/40 text-slate-400 hover:text-emerald-400 px-2 py-0.5 rounded transition-all"
        >
          Enable all
        </button>
        <button
          type="button"
          onClick={disableAll}
          className="font-bold uppercase tracking-wider border border-slate-700 hover:border-red-500/40 text-slate-400 hover:text-red-400 px-2 py-0.5 rounded transition-all"
        >
          Disable all
        </button>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                {CATEGORY_LABEL[cat]}
              </p>
              <ul className="space-y-1">
                {items.map((s) => {
                  const isDisabled = disabledSet.has(s.name);
                  const isLocalOther = s.category === "local" && !currentLocalSet.has(s.name);
                  const isCurrentLocal = s.category === "local" && currentLocalSet.has(s.name);
                  const stat = stats.get(s.name);
                  return (
                    <li
                      key={s.name}
                      className={`flex items-center gap-2 px-2 py-1 rounded border transition-colors ${
                        isDisabled
                          ? "bg-slate-900/40 border-slate-800 opacity-60"
                          : "bg-slate-800/40 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          onChange={() => toggle(s.name)}
                          className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 accent-emerald-500 flex-shrink-0"
                        />
                        <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[s.category]}`}>
                          {s.category}
                        </span>
                        <span className="text-xs text-slate-200 truncate" title={s.url}>{s.name}</span>
                        {isCurrentLocal && !baseNames.has(s.name) && (
                          <span className="text-[9px] text-emerald-400 font-mono flex-shrink-0">· current local</span>
                        )}
                        {isLocalOther && (
                          <span className="text-[9px] text-slate-600 font-mono flex-shrink-0">· other location</span>
                        )}
                        <span className="flex-1" />
                        {/* Per-source volume + token estimate. statsLoading
                            renders a tiny placeholder so the row layout
                            doesn't snap once the fetch resolves. */}
                        {statsLoading ? (
                          <span className="text-[9px] text-slate-700 font-mono flex-shrink-0 animate-pulse">…</span>
                        ) : stat ? (
                          <span
                            className="text-[9px] text-slate-500 font-mono flex-shrink-0 tabular-nums"
                            title={`${stat.count} items, ~${formatTokens(stat.totalChars)} if all sent to Claude`}
                          >
                            {stat.count} · {formatTokens(stat.totalChars)}
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-700 font-mono flex-shrink-0">— no data</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OsintFeedsEditor({ value, onChange }: { value: OsintFeed[]; onChange: (v: OsintFeed[]) => void; }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<OsintFeed["kind"]>("social");
  const [health, setHealth] = useState<Record<string, OsintFeedHealth>>({});
  const [healthLoading, setHealthLoading] = useState(false);
  // Per-row + add-form test state. "new" is the sentinel key for the
  // add-form's tester. Tests are user-initiated (Test button), so the result
  // object hangs around until the user dismisses it via the × in the panel.
  const [testResults, setTestResults] = useState<Record<string, DiagnosticResult>>({});
  const [testing, setTesting] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (value.length === 0) { setHealth({}); return; }
    setHealthLoading(true);
    fetch("/api/osint/feed")
      .then((r) => r.json())
      .then((d) => {
        const arr: OsintFeedHealth[] = Array.isArray(d?.feeds) ? d.feeds : [];
        const map: Record<string, OsintFeedHealth> = {};
        for (const f of arr) map[f.id] = f;
        setHealth(map);
      })
      .catch(() => {})
      .finally(() => setHealthLoading(false));
  }, [value.length]);

  const healthLabel = (h: OsintFeedHealth | undefined): { dot: string; title: string } => {
    if (!h || !h.fetchedAt) return { dot: "bg-slate-700", title: "Not fetched yet" };
    const ageMin = Math.floor((Date.now() - h.fetchedAt) / 60_000);
    const ageLabel = ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
    if (!h.ok) return { dot: "bg-red-500", title: `Last fetch failed · ${ageLabel}` };
    if (h.count === 0) return { dot: "bg-amber-500", title: `0 items · last fetched ${ageLabel}` };
    return { dot: "bg-emerald-500", title: `${h.count} items · last fetched ${ageLabel}` };
  };

  // Run the diagnostic against an arbitrary URL. `key` is either an existing
  // feed's id or the sentinel "new" for the add-form. Setting the result
  // populates the inline TestResultPanel for that row.
  const runTest = async (key: string, testUrl: string) => {
    if (!testUrl.trim()) return;
    setTesting((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/osint/test-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: testUrl.trim() }),
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [key]: data }));
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [key]: { ok: false, url: testUrl, error: e instanceof Error ? e.message : "Network error", durationMs: 0 },
      }));
    } finally {
      setTesting((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  };
  const closeTest = (key: string) => {
    setTestResults((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const add = () => {
    const trimUrl = url.trim();
    const trimLabel = label.trim().slice(0, 60);
    if (!trimUrl || !trimLabel) return;
    try {
      const u = new URL(trimUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") return;
    } catch { return; }
    onChange([...value, { id: `${kind}-${Date.now()}`, label: trimLabel, url: trimUrl.slice(0, 500), kind }]);
    setLabel(""); setUrl("");
    closeTest("new");
  };

  // One-click add from the curated suggestion list. Same URL = no-op (the
  // suggestion's Add button is disabled in that case). Each insert uses the
  // suggestion's label and kind as the saved values.
  // In-place URL swap for an existing feed row. Preserves id / label / kind
  // and only updates the URL — then re-runs the diagnostic so the user sees
  // whether the alternative actually worked.
  const swapFeedUrl = (id: string, newUrl: string) => {
    const next = value.map((f) => f.id === id ? { ...f, url: newUrl.slice(0, 500) } : f);
    onChange(next);
    runTest(id, newUrl);
  };

  const addSuggestion = (s: OsintFeedSuggestion) => {
    if (value.length >= 20) return;
    if (value.some((f) => f.url === s.url)) return;
    onChange([
      ...value,
      {
        id: `${s.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: s.label.slice(0, 60),
        url: s.url.slice(0, 500),
        kind: s.kind,
      },
    ]);
  };

  const KIND_STYLE: Record<OsintFeed["kind"], string> = {
    social:   "bg-sky-500/15 text-sky-300 border-sky-500/40",
    telegram: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
    news:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    other:    "bg-slate-700/40 text-slate-300 border-slate-600",
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        OSINT Feeds
      </label>
      <p className="text-[10px] text-slate-600 mb-2 leading-relaxed">
        RSS / Atom URLs shown on the OSINT tab. Up to 20. The <span className="text-slate-400 font-bold">Test</span> button
        on each row diagnoses what the upstream is returning (status, item count,
        common-failure hints).
      </p>
      <details className="text-[10px] text-slate-600 mb-3 leading-relaxed bg-slate-900/40 border border-slate-800 rounded-md px-2.5 py-1.5">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none">
          Bridges that usually work (and the ones that don&apos;t)
        </summary>
        <div className="pt-2 space-y-1.5">
          <p>
            <span className="text-amber-400 font-bold">⚠ Twitter / X via rsshub.app is broken most days</span> —
            X actively blocks scrapers and the public <code>rsshub.app</code> instance is heavily rate-limited.
            If your feed returns 0 items, try a different instance:
          </p>
          <ul className="ml-3 space-y-0.5 font-mono">
            <li>· <code className="text-emerald-400">https://rsshub.feeded.xyz/twitter/user/USERNAME</code></li>
            <li>· <code className="text-emerald-400">https://rsshub.rssforever.com/twitter/user/USERNAME</code></li>
            <li>· <code className="text-emerald-400">https://nitter.privacydev.net/USERNAME/rss</code></li>
          </ul>
          <p>
            Telegram channels (more reliable):
            <code className="text-emerald-400 ml-1">https://rsshub.app/telegram/channel/NAME</code>
          </p>
          <p>
            News sites usually expose their own RSS — look for an <code>/rss</code> or <code>/feed</code> path
            on the publisher&apos;s site. Native feeds are always more reliable than scraper bridges.
          </p>
        </div>
      </details>

      {/* Curated suggestions — collapsed by default so the editor stays
          compact for returning users. One click per feed; URL is pre-baked
          to a known pattern (mostly rsshub.app Telegram bridges since
          Telegram doesn't aggressively block scrapers). */}
      <details className="text-[10px] mb-3 bg-slate-900/40 border border-slate-800 rounded-md px-2.5 py-1.5">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none flex items-center gap-1.5">
          <span className="text-emerald-400">💡</span>
          <span className="uppercase tracking-wider font-bold">Suggested feeds</span>
          <span className="text-slate-600 font-mono normal-case tracking-normal">
            ({OSINT_FEED_SUGGESTIONS.reduce((n, g) => n + g.feeds.length, 0)} curated)
          </span>
        </summary>
        <div className="pt-2 space-y-3 max-h-80 overflow-y-auto">
          {OSINT_FEED_SUGGESTIONS.map((group) => (
            <div key={group.name}>
              <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{group.name}</p>
              {group.description && (
                <p className="text-[10px] text-slate-600 mb-1.5 leading-snug">{group.description}</p>
              )}
              <ul className="space-y-1">
                {group.feeds.map((s) => {
                  const alreadyAdded = value.some((f) => f.url === s.url);
                  const atCap = !alreadyAdded && value.length >= 20;
                  return (
                    <li
                      key={s.url}
                      className="flex items-center gap-2 bg-slate-800/40 border border-slate-800 rounded px-2 py-1"
                    >
                      <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border ${KIND_STYLE[s.kind]}`}>
                        {s.kind}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-200 truncate" title={s.note}>{s.label}</span>
                          {s.bias && (
                            <span className="text-[9px] text-amber-400 font-mono px-1 py-0 rounded bg-amber-500/10 border border-amber-500/20 truncate">
                              {s.bias}
                            </span>
                          )}
                        </div>
                        {s.note && <p className="text-[9px] text-slate-600 leading-tight truncate" title={s.note}>{s.note}</p>}
                      </div>
                      <button
                        onClick={() => addSuggestion(s)}
                        disabled={alreadyAdded || atCap}
                        title={
                          alreadyAdded ? "Already in your list"
                          : atCap ? "Feed limit reached (20)"
                          : "Add to OSINT feeds"
                        }
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border transition-all flex-shrink-0 ${
                          alreadyAdded
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 cursor-default"
                            : atCap
                            ? "border-slate-700 text-slate-600 cursor-not-allowed"
                            : "border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40"
                        }`}
                      >
                        {alreadyAdded ? "✓ Added" : "+ Add"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-[10px] text-slate-600 leading-snug border-t border-slate-800 pt-2">
            Slugs are best-effort — if a feed returns 0 items via the Test button, search t.me/SLUG to verify it; some channels rename. Telegram bridges work far more reliably than Twitter ones.
          </p>
        </div>
      </details>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5 max-h-72 overflow-y-auto">
          {value.map((f) => {
            const h = healthLabel(health[f.id]);
            const result = testResults[f.id];
            const isTesting = testing.has(f.id);
            return (
              <li key={f.id} className="bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${h.dot} ${healthLoading ? "animate-pulse" : ""}`}
                    title={h.title}
                  />
                  <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${KIND_STYLE[f.kind]}`}>
                    {f.kind}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 truncate">{f.label}</p>
                    <p className="text-[9px] text-slate-600 font-mono truncate">{f.url}</p>
                  </div>
                  <button
                    onClick={() => runTest(f.id, f.url)}
                    disabled={isTesting}
                    title="Fetch the URL now and report status / item count / hints"
                    className="text-[10px] font-bold uppercase tracking-wider bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/40 text-slate-400 hover:text-emerald-400 px-2 py-0.5 rounded transition-all disabled:opacity-40 flex-shrink-0"
                  >
                    {isTesting ? "…" : "Test"}
                  </button>
                  <button
                    onClick={() => onChange(value.filter((x) => x.id !== f.id))}
                    className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1 flex-shrink-0"
                  >
                    ×
                  </button>
                </div>
                {result && (
                  <TestResultPanel
                    r={result}
                    onClose={() => closeTest(f.id)}
                    onSwapTo={(newUrl) => swapFeedUrl(f.id, newUrl)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. @CSIS)"
          className="bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as OsintFeed["kind"])}
          className="bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-slate-500"
        >
          <option value="social">Social (X/Twitter)</option>
          <option value="telegram">Telegram</option>
          <option value="news">News</option>
          <option value="other">Other</option>
        </select>
        <input
          value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://rsshub.app/twitter/user/USERNAME"
          className="col-span-2 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <button
          onClick={() => runTest("new", url)}
          disabled={!url.trim() || testing.has("new")}
          className="text-[11px] font-bold border border-slate-700 hover:border-emerald-500/40 text-slate-300 hover:text-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40"
        >
          {testing.has("new") ? "Testing…" : "Test First"}
        </button>
        <button
          onClick={add}
          disabled={!label.trim() || !url.trim() || value.length >= 20}
          className="text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add Feed
        </button>
        {testResults.new && (
          <div className="col-span-2">
            <TestResultPanel
              r={testResults.new}
              onClose={() => closeTest("new")}
              onSwapTo={(newUrl) => { setUrl(newUrl); runTest("new", newUrl); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AI control panel (toggles + spend) ──────────────────────────────────────

function formatUsd(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// Map a route name back to its human label, falling back to the raw route id
// if a new route name lands without a label entry.
const ROUTE_LABEL: Record<string, string> = Object.fromEntries(
  ALL_AI_FEATURES.map((f) => [f, AI_FEATURE_LABELS[f].label])
);

function AIControlPanel({
  aiEnabled, onAiEnabled, toggles, onToggles,
}: {
  aiEnabled: boolean;
  onAiEnabled: (v: boolean) => void;
  toggles: Partial<Record<AiFeature, boolean>>;
  onToggles: (v: Partial<Record<AiFeature, boolean>>) => void;
}) {
  const [usage, setUsage] = useState<{
    today: AiUsageSummary; last7: AiUsageSummary; last30: AiUsageSummary;
  } | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    fetch("/api/ai-usage")
      .then((r) => r.json())
      .then((d) => setUsage({ today: d.today, last7: d.last7, last30: d.last30 }))
      .catch(() => {});
  }, []);

  const setFeature = (feature: AiFeature, enabled: boolean) => {
    onToggles({ ...toggles, [feature]: enabled });
  };

  // Per-feature toggles are opt-out: missing key = enabled. Master switch
  // off greys out everything regardless of per-feature state.
  const featureEnabled = (f: AiFeature) =>
    aiEnabled && toggles[f] !== false;

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        AI Controls
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Disable Anthropic API calls per feature or globally. All features fall
        back to non-AI behaviour when off — no errors, just degraded output
        (snippets instead of summaries, etc).
      </p>

      {/* Master switch */}
      <div className={`rounded-lg border p-3 mb-3 ${
        aiEnabled ? "bg-emerald-500/10 border-emerald-500/40" : "bg-red-500/10 border-red-500/40"
      }`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onAiEnabled(!aiEnabled)}
            role="switch"
            aria-checked={aiEnabled}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
              aiEnabled ? "bg-emerald-500" : "bg-slate-700"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              aiEnabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold ${aiEnabled ? "text-emerald-300" : "text-red-300"}`}>
              {aiEnabled ? "AI features ENABLED" : "AI features DISABLED (all)"}
            </p>
            <p className="text-[10px] text-slate-500 font-mono leading-snug">
              Master kill switch. Off = no Anthropic API calls anywhere.
            </p>
          </div>
        </div>
      </div>

      {/* Per-feature toggles */}
      <ul className={`space-y-1 mb-3 ${aiEnabled ? "" : "opacity-50"}`}>
        {ALL_AI_FEATURES.map((f) => {
          const enabled = featureEnabled(f);
          const meta = AI_FEATURE_LABELS[f];
          return (
            <li key={f} className="flex items-center gap-2.5 py-1.5">
              <button
                onClick={() => setFeature(f, !(toggles[f] !== false))}
                disabled={!aiEnabled}
                role="switch"
                aria-checked={enabled}
                className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 disabled:cursor-not-allowed ${
                  enabled ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 leading-tight">{meta.label}</p>
                <p className="text-[10px] text-slate-600 font-mono leading-tight">{meta.sub}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Usage summary */}
      {usage && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Today's spend
            </p>
            <span className="text-[10px] text-slate-600 font-mono">
              {usage.today.totalCalls} call{usage.today.totalCalls === 1 ? "" : "s"}
            </span>
          </div>
          <p className={`text-2xl font-bold ${
            usage.today.totalMicros === 0 ? "text-slate-500" : "text-emerald-300"
          }`}>
            {formatUsd(usage.today.totalMicros)}
          </p>
          <div className="flex items-baseline justify-between gap-2 mt-1.5 pt-1.5 border-t border-slate-700/60 text-[10px] font-mono">
            <span className="text-slate-500">Last 7 days</span>
            <span className="text-slate-300">{formatUsd(usage.last7.totalMicros)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
            <span className="text-slate-500">Last 30 days</span>
            <span className="text-slate-300">{formatUsd(usage.last30.totalMicros)}</span>
          </div>

          {usage.today.byRoute.length > 0 && (
            <>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-mono mt-2 transition-colors"
              >
                {showBreakdown ? "▲ Hide" : "▼ Show"} today's breakdown
              </button>
              {showBreakdown && (
                <ul className="mt-2 space-y-0.5">
                  {usage.today.byRoute.map((r) => (
                    <li key={r.route} className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
                      <span className="text-slate-400 truncate">
                        {ROUTE_LABEL[r.route] ?? r.route}
                      </span>
                      <span className="text-slate-500 flex-shrink-0">
                        {formatUsd(r.micros)} · {r.calls}
                        {typeof r.p50Ms === "number" && (
                          <span className="text-slate-600" title="Model-call latency p50 / p95 today">
                            {" "}· {(r.p50Ms / 1000).toFixed(1)}s{typeof r.p95Ms === "number" && r.p95Ms !== r.p50Ms ? `/${(r.p95Ms / 1000).toFixed(1)}s` : ""}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Long-term memory panel ──────────────────────────────────────────────────

function MemoryPanel() {
  const [content, setContent] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    fetch("/api/user-memory")
      .then((r) => r.json())
      .then(({ memory }: { memory: { content: string; lastUpdated: string } }) => {
        setContent(memory?.content ?? "");
        setLastUpdated(memory?.lastUpdated ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loaded]);

  const save = async () => {
    setBusy(true);
    try {
      await fetch("/api/user-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setLastUpdated(new Date().toISOString());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Clear all stored memory? This can't be undone.")) return;
    setBusy(true);
    try {
      await fetch("/api/user-memory", { method: "DELETE" });
      setContent("");
      setLastUpdated(null);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const fmtUpdated = lastUpdated && new Date(lastUpdated).getTime() > 0
    ? new Date(lastUpdated).toLocaleString()
    : "never";

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Long-term Memory
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Auto-maintained from chat. The assistant remembers projects, upcoming events,
        people you mention, and ad-hoc notes — injected into every AI response.
        Last updated: <span className="font-mono">{fmtUpdated}</span>
      </p>

      {!editing ? (
        <>
          <div className="bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-[11px] text-slate-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            {content.trim() || (
              <span className="text-slate-600 italic">Memory is empty — chat a bit and it'll fill in.</span>
            )}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              className="flex-1 text-[11px] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={clear}
              disabled={busy || !content}
              className="flex-1 text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Clear all
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="The assistant's memory of you — usually managed automatically. Edit if needed."
            className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-[11px] text-slate-200 placeholder-slate-600 resize-none outline-none focus:border-slate-500 transition-colors font-mono leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-2.5 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="flex-1 text-[11px] text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── iCal subscription block ──────────────────────────────────────────────────

function CalendarSubscription() {
  const [copied, setCopied] = useState(false);
  // Built from window.location so it always reflects the current host.
  const httpsUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/calendar/ical`
    : "/api/calendar/ical";
  const webcalUrl = typeof window !== "undefined"
    ? `webcal://${window.location.host}/api/calendar/ical`
    : "";

  const copy = async () => {
    try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable */ }
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Apple Calendar / iCal Feed
      </label>
      <p className="text-[10px] text-slate-600 mb-2">
        Subscribe to your upcoming events in any iCal-compatible app (Apple Calendar, iOS, Outlook).
        The feed is session-authenticated — copy the URL while signed in.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-3 py-2 text-[11px] text-slate-300 font-mono truncate" title={httpsUrl}>
          {httpsUrl}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 text-[11px] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all font-mono"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {webcalUrl && (
          <a
            href={webcalUrl}
            className="flex-shrink-0 text-[11px] text-emerald-500 hover:text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 px-2.5 py-1.5 rounded-md transition-all font-mono"
          >
            Open in Apple Calendar
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Theme selector ───────────────────────────────────────────────────────────

const THEMES: {
  id: AppTheme;
  name: string;
  desc: string;
  bg: string;
  surface: string;
  accent: string;
  accentLabel: string;
}[] = [
  {
    id: "nightwatch",
    name: "Nightwatch",
    desc: "Deep slate / emerald",
    bg: "#020617",
    surface: "#0f172a",
    accent: "#10b981",
    accentLabel: "emerald",
  },
  {
    id: "amber",
    name: "Amber",
    desc: "Tactical terminal / phosphor",
    bg: "#0c0800",
    surface: "#160f00",
    accent: "#f59e0b",
    accentLabel: "amber",
  },
  {
    id: "arctic",
    name: "Arctic",
    desc: "Midnight navy / ice-blue",
    bg: "#03091a",
    surface: "#07112a",
    accent: "#0ea5e9",
    accentLabel: "sky",
  },
  {
    id: "mission",
    name: "Mission Brief",
    desc: "Parchment / aviation blue",
    bg: "#f5f4f0",
    surface: "#ffffff",
    accent: "#185FA5",
    accentLabel: "blue",
  },
];

function ThemeSelector({
  value,
  onChange,
}: {
  value: AppTheme;
  onChange: (t: AppTheme) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {THEMES.map((theme) => {
        const active = value === theme.id;
        return (
          <button
            key={theme.id}
            onClick={() => onChange(theme.id)}
            className={`flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all ${
              active ? "border-emerald-500/60 shadow-[0_0_14px_-2px_var(--glow-accent)]" : "border-slate-700/60 hover:border-slate-600/80"
            }`}
            title={theme.name}
          >
            {/* Mini preview */}
            <div
              className="h-14 w-full relative"
              style={{ backgroundColor: theme.bg }}
            >
              {/* Simulated card */}
              <div
                className="absolute inset-x-2 top-2 bottom-2 rounded-md flex flex-col justify-between p-1.5"
                style={{ backgroundColor: theme.surface, border: `1px solid ${theme.accent}22` }}
              >
                <div className="flex gap-1 items-center">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.accent }} />
                  <div className="h-1 rounded-full flex-1" style={{ backgroundColor: `${theme.accent}40` }} />
                </div>
                <div className="space-y-0.5">
                  <div className="h-0.5 rounded-full w-3/4" style={{ backgroundColor: `${theme.accent}60` }} />
                  <div className="h-0.5 rounded-full w-1/2" style={{ backgroundColor: `${theme.accent}30` }} />
                </div>
              </div>
              {active && (
                <div
                  className="absolute top-1 right-1 w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold"
                  style={{ backgroundColor: theme.accent, color: theme.bg }}
                >
                  ✓
                </div>
              )}
            </div>
            {/* Label */}
            <div className="px-2 py-1.5 bg-slate-800/40">
              <p className={`text-[10px] font-bold font-mono ${active ? "text-slate-100" : "text-slate-400"}`}>
                {theme.name}
              </p>
              <p className="text-[9px] text-slate-600 leading-tight">{theme.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Preset locations — value = localFeedKey, lat/lon used by weather tab
const LOCAL_FEED_OPTIONS: { value: string; label: string; lat: number; lon: number }[] = [
  { value: "colorado",      label: "Colorado — Front Range / CSFS",         lat: 38.85, lon: -104.80 },
  { value: "dc",            label: "DC Metro — National Capital Region",     lat: 38.90, lon: -77.03  },
  { value: "hampton_roads", label: "Hampton Roads — Tidewater VA",           lat: 36.85, lon: -76.29  },
  { value: "illinois",      label: "Illinois — Chicago / Scott AFB",         lat: 41.88, lon: -87.63  },
  { value: "new_jersey",    label: "New Jersey — JB McGuire-Dix-Lakehurst", lat: 40.01, lon: -74.59  },
  { value: "oklahoma",      label: "Oklahoma — OKC / Altus AFB",             lat: 35.47, lon: -97.38  },
  { value: "san_antonio",   label: "San Antonio — Joint Base SA",            lat: 29.42, lon: -98.49  },
  { value: "hawaii",        label: "Hawaii — Oahu / Joint Base PHH",         lat: 21.30, lon: -157.85 },
  { value: "japan",         label: "Japan / Pacific — Okinawa (Kadena)",     lat: 26.33, lon:  127.80 },
  { value: "germany",       label: "Germany / Europe — Ramstein Area",       lat: 49.43, lon:    7.60 },
];

// Precise home-location picker. Home coords (localLat/localLon) drive the Weather
// tab, the Morning Brief's home forecast, and the map center. A non-empty `city`
// (the display label) marks a custom home; empty falls back to the local-news
// region preset's coords. Uses the same geocoder + coord parsing as the tracked-
// locations editor.
function HomeLocationEditor({
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

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York",    label: "Eastern (ET)" },
  { value: "America/Chicago",     label: "Central (CT)" },
  { value: "America/Denver",      label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage",   label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HST)" },
  { value: "Asia/Tokyo",          label: "Japan (JST)" },
  { value: "Europe/Berlin",       label: "Germany (CET/CEST)" },
  { value: "UTC",                 label: "UTC" },
];

// ─── ACLED credentials editor ────────────────────────────────────────────────
// Self-contained: reads/writes its own /api/settings/acled endpoint rather than
// riding the main prefs object, so the password stays server-side and a prefs
// Save never touches it. Has its own Save/Clear independent of the drawer's
// footer Save button.
function AcledCredentialsEditor() {
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"env" | "settings" | null>(null);
  const [savedEmail, setSavedEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [diag, setDiag] = useState<string[] | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  // Live end-to-end check of all three Crisis-map sources — turns "no data"
  // into a concrete status (token vs read failure, GDELT/GPSJam reachability).
  const runDiag = async () => {
    setDiagBusy(true); setDiag(null);
    try {
      const r = await fetch("/api/osint/crisis-diag");
      const d = await r.json();
      const lines: string[] = [];
      const a = d.acled ?? {};
      lines.push(
        !a.configured ? "ACLED: not configured."
        : !a.tokenOk ? `ACLED: ✗ login failed — ${a.note ?? a.error ?? "token rejected"}`
        : `ACLED: token OK · read HTTP ${a.readStatus ?? "?"} · ${a.count ?? 0} events${a.sample ? ` (e.g. ${a.sample})` : ""}`,
      );
      if (a.error && a.tokenOk) lines.push(`  ↳ ACLED said: "${a.error}"`);
      if (a.note && a.tokenOk) lines.push(`  ↳ ${a.note}`);
      const g = d.gdelt ?? {};
      lines.push("GDELT variants:");
      for (const v of g.variants ?? []) {
        lines.push(`  · ${v.label}: HTTP ${v.status}${v.status === 200 ? ` · ${v.features ?? 0} results` : v.body ? ` — ${v.body}` : ""}`);
      }
      if (g.note) lines.push(`  ↳ ${g.note}`);
      const j = d.gpsjam ?? {};
      lines.push(`GPSJam: today HTTP ${j.today?.status ?? "?"}, yesterday HTTP ${j.yesterday?.status ?? "?"}${j.note ? ` — ${j.note}` : ""}`);
      setDiag(lines);
    } catch {
      setDiag(["Diagnostic request failed — are you still signed in?"]);
    } finally {
      setDiagBusy(false);
    }
  };

  useEffect(() => {
    fetch("/api/settings/acled")
      .then((r) => r.json())
      .then((d: { source?: "env" | "settings" | null; email?: string }) => {
        setSource(d.source ?? null);
        setSavedEmail(d.email ?? "");
        setEmail(d.email ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/settings/acled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tone: "err", text: d?.error || "Save failed." }); return; }
      setSavedEmail(d.email ?? email.trim());
      setSource("settings");
      setPassword("");
      setMsg(d.verified
        ? { tone: "ok", text: "Saved & verified — the ACLED layer will populate on the next Crisis-map refresh." }
        : { tone: "warn", text: "Saved, but ACLED didn't accept these credentials (or was unreachable). Double-check the email/password and that your account is verified." });
    } catch {
      setMsg({ tone: "err", text: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/settings/acled", { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tone: "err", text: d?.error || "Couldn't clear." }); return; }
      setSavedEmail(""); setEmail(""); setPassword(""); setSource(null);
      setMsg({ tone: "ok", text: "Credentials cleared — the ACLED layer is now off." });
    } catch {
      setMsg({ tone: "err", text: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  };

  const msgClass = msg?.tone === "ok" ? "text-emerald-400" : msg?.tone === "warn" ? "text-amber-400" : "text-red-400";

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        ACLED Strikes <span className="text-slate-600 font-normal normal-case tracking-normal">· Crisis-map layer</span>
      </label>
      <p className="text-[10px] text-slate-600 mb-2 leading-relaxed">
        Structured conflict events (precise strikes/battles with sub-event type, actors, fatalities) on the OSINT → Crisis
        map. Register a free account at <a href="https://acleddata.com/register/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">acleddata.com/register</a>,
        then enter that account&apos;s email + password — ACLED uses OAuth, so this is the login, not an API key. Stored
        server-side; the password is never sent back to the browser. Data © ACLED.
      </p>

      {loading ? (
        <div className="h-9 bg-slate-900/60 border border-slate-800 rounded-md animate-pulse" />
      ) : source === "env" ? (
        <div className="text-[11px] text-slate-400 bg-slate-900/40 border border-slate-800 rounded-md px-3 py-2">
          <span className="text-emerald-400 font-bold">✓ Configured via environment variable</span>
          {savedEmail && <span className="font-mono text-slate-500"> · {savedEmail}</span>}
          <p className="text-[10px] text-slate-600 mt-1">Managed by the deployment&apos;s env vars (<code>ACLED_EMAIL</code> / <code>ACLED_PASSWORD</code>); clear those to edit here instead.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ACLED account email"
            className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={savedEmail ? "Password (leave blank to keep current)" : "ACLED account password"}
            className="w-full bg-slate-900/60 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-slate-600"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !email.trim() || !password}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {busy ? "Saving…" : savedEmail ? "Update & verify" : "Save & verify"}
            </button>
            {savedEmail && (
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider border border-slate-700 text-slate-400 hover:border-red-500/40 hover:text-red-400 disabled:opacity-40 transition-all"
              >
                Clear
              </button>
            )}
            {savedEmail && <span className="text-[10px] font-mono text-slate-600">current: {savedEmail}</span>}
          </div>
          {msg && <p className={`text-[10px] leading-snug ${msgClass}`}>{msg.text}</p>}
        </div>
      )}

      {/* Live data-source check — covers ACLED + the keyless GDELT/GPSJam
          layers, so "source down" / "no ACLED data" becomes a concrete status. */}
      {!loading && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-800/60">
          <button
            type="button"
            onClick={runDiag}
            disabled={diagBusy}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-40 transition-all"
            title="Live check: runs the ACLED token + read and pings GDELT / GPSJam from the server"
          >
            {diagBusy ? "Checking…" : "Run data-source check"}
          </button>
          {diag && (
            <pre className="mt-2 text-[10px] leading-relaxed text-slate-400 font-mono whitespace-pre-wrap bg-slate-950/50 border border-slate-800 rounded-md p-2.5">{diag.join("\n")}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TDY / travel trips editor ───────────────────────────────────────────────
// Self-contained (own /api/trips endpoint, not the main prefs blob). The active
// trip becomes the effective location — overrides home for weather + the brief.
interface TripRow { id: string; label: string; location: string; startDate: string; endDate: string; feedKey: string | null; source?: "manual" | "calendar" }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function TripsEditor() {
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
                      ? <span className="text-[9px] font-mono text-slate-700 flex-shrink-0" title="Synced from a calendar event — edit the event's dates to change this">📅 calendar</span>
                      : <span className="text-[9px] font-mono text-slate-700 flex-shrink-0">{t.feedKey ? `news: ${t.feedKey}` : "news: geo"}</span>}
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

export default function PreferencesDrawer({ open, onClose, onSaved }: PreferencesDrawerProps) {
  const { data: session } = useSession();
  const primaryEmail = session?.user?.email ?? null;

  const [role, setRole] = useState("");
  const [priorityTopics, setPriorityTopics] = useState<string[]>([]);
  const [deprioritizeTopics, setDeprioritizeTopics] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [vipSenders, setVipSenders] = useState<string[]>([]);
  const [muteSenders, setMuteSenders] = useState<string[]>([]);
  const [trackedLocations, setTrackedLocations] = useState<TrackedLocation[]>([]);
  const [marketsWatchlist, setMarketsWatchlist] = useState<TickerEntry[]>([]);
  const [osintFeeds, setOsintFeeds] = useState<OsintFeed[]>([]);
  const [newsletterSources, setNewsletterSources] = useState<NewsletterSourceRule[]>([]);
  const [metarStations, setMetarStations] = useState<MetarStation[]>([]);
  const [disabledNewsSources, setDisabledNewsSources] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiFeatureToggles, setAiFeatureToggles] = useState<Partial<Record<AiFeature, boolean>>>({});
  const [localFeedKey, setLocalFeedKey] = useState("colorado");
  const [localLat, setLocalLat] = useState<number | null>(null);
  const [localLon, setLocalLon] = useState<number | null>(null);
  // Non-empty = a precise custom home the user entered (its display label).
  // Empty = home falls back to the local-news region preset's coords.
  const [localCity, setLocalCity] = useState("");
  const [theme, setTheme] = useState<AppTheme>("nightwatch");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [secondaryConnected, setSecondaryConnected] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState<string | null>(null);
  const [secondaryRevoking, setSecondaryRevoking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Collapsible-group state. Default for first-time users: only "you" is
  // open (gives an entry point). Returning users get whatever they last
  // had open, restored from localStorage in the effect below.
  type GroupKey = "you" | "connections" | "email" | "sources" | "ai";
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    you: true, connections: false, email: false, sources: false, ai: false,
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem("prefs-groups-state");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setOpenGroups({
            you:         parsed.you === true,
            connections: parsed.connections === true,
            email:       parsed.email === true,
            sources:     parsed.sources === true,
            ai:          parsed.ai === true,
          });
        }
      }
    } catch { /* fall through to defaults */ }
  }, []);
  const persistGroups = (next: Record<GroupKey, boolean>) => {
    try { localStorage.setItem("prefs-groups-state", JSON.stringify(next)); } catch { /* noop */ }
  };
  const toggleGroup = (k: GroupKey) => {
    setOpenGroups((prev) => { const next = { ...prev, [k]: !prev[k] }; persistGroups(next); return next; });
  };
  const openAndScrollTo = (k: GroupKey) => {
    setOpenGroups((prev) => { const next = { ...prev, [k]: true }; persistGroups(next); return next; });
    // Defer so the expanded panel exists before scrollIntoView fires.
    setTimeout(() => {
      const el = document.getElementById(`prefs-group-${k}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };
  const GROUPS: { key: GroupKey; label: string }[] = [
    { key: "you",         label: "You" },
    { key: "connections", label: "Connections & appearance" },
    { key: "email",       label: "Email rules" },
    { key: "sources",     label: "Content sources" },
    { key: "ai",          label: "AI & memory" },
  ];

  // Live-state summaries shown next to each group label. Returns
  // ReactNode (not just a string) so warnings — stale feeds, master AI
  // off — can render in amber to draw attention from the collapsed header.
  // All values derive from existing form state plus the two parent-level
  // fetches above (feedStaleCount, aiSpendTodayMicros); no extra requests.
  const groupSubtitle = (key: GroupKey) => {
    if (key === "you") {
      const parts: string[] = [];
      if (role.trim()) parts.push("role set");
      if (priorityTopics.length) parts.push(`${priorityTopics.length} priority`);
      if (deprioritizeTopics.length) parts.push(`${deprioritizeTopics.length} deprio`);
      if (watchlist.length) parts.push(`${watchlist.length} watch`);
      return parts.length ? parts.join(" · ") : "Not configured yet";
    }
    if (key === "connections") {
      const parts: string[] = [];
      parts.push(primaryEmail ? "Primary linked" : "No primary");
      parts.push(secondaryConnected ? "Secondary linked" : "No secondary");
      parts.push(`${theme} theme`);
      return parts.join(" · ");
    }
    if (key === "email") {
      const parts: string[] = [];
      if (vipSenders.length) parts.push(`${vipSenders.length} VIP`);
      if (muteSenders.length) parts.push(`${muteSenders.length} muted`);
      return parts.length ? parts.join(" · ") : "No overrides";
    }
    if (key === "sources") {
      const parts: (string | ReactElement)[] = [];
      if (trackedLocations.length) parts.push(`${trackedLocations.length} loc`);
      if (marketsWatchlist.length) parts.push(`${marketsWatchlist.length} tickers`);
      // News-source count: total enabled, with a muted "(N off)" only when
      // any are disabled — keeps the header quiet for the default state.
      const totalNews = allKnownNewsSources().length;
      const enabledNews = totalNews - disabledNewsSources.length;
      if (disabledNewsSources.length > 0) {
        parts.push(
          <span key="news">
            {enabledNews}/{totalNews} news{" "}
            <span className="text-amber-400">({disabledNewsSources.length} off)</span>
          </span>
        );
      } else {
        parts.push(`${totalNews} news`);
      }
      if (osintFeeds.length) {
        if (feedStaleCount !== null && feedStaleCount > 0) {
          parts.push(
            <span key="feeds">
              {osintFeeds.length} feeds{" "}
              <span className="text-amber-400">({feedStaleCount} stale)</span>
            </span>
          );
        } else {
          parts.push(`${osintFeeds.length} feeds`);
        }
      }
      if (parts.length === 0) return "No sources configured";
      // Join string parts with " · " and React elements with separators.
      return parts.flatMap((p, i) => i === 0 ? [p] : [" · ", p]);
    }
    if (key === "ai") {
      const totalFeatures = ALL_AI_FEATURES.length;
      const enabledCount = ALL_AI_FEATURES.filter((f) => aiFeatureToggles[f] !== false).length;
      const dollars = aiSpendTodayMicros !== null ? `$${(aiSpendTodayMicros / 1_000_000).toFixed(2)} today` : null;
      if (!aiEnabled) {
        return (
          <>
            <span className="text-amber-400 font-bold">Master OFF</span>
            {dollars && <> · {dollars}</>}
          </>
        );
      }
      const parts: string[] = [`${enabledCount}/${totalFeatures} features on`];
      if (dollars) parts.push(dollars);
      return parts.join(" · ");
    }
    return "";
  };

  useEffect(() => {
    if (!open || loaded) return;
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }: { prefs: UserPrefs }) => {
        setRole(prefs.role ?? "");
        setPriorityTopics(prefs.priorityTopics ?? []);
        setDeprioritizeTopics(prefs.deprioritizeTopics ?? []);
        setWatchlist(prefs.watchlist ?? []);
        setVipSenders(prefs.vipSenders ?? []);
        setMuteSenders(prefs.muteSenders ?? []);
        setTrackedLocations(prefs.trackedLocations ?? []);
        setMarketsWatchlist(prefs.marketsWatchlist ?? []);
        setOsintFeeds(prefs.osintFeeds ?? []);
        setNewsletterSources(prefs.newsletterSources ?? []);
        setMetarStations(prefs.metarStations ?? []);
        setDisabledNewsSources(prefs.disabledNewsSources ?? []);
        setAiEnabled(prefs.aiEnabled !== false);
        setAiFeatureToggles(prefs.aiFeatureToggles ?? {});
        setLocalFeedKey(prefs.localFeedKey ?? "colorado");
        setLocalLat(prefs.localLat ?? null);
        setLocalLon(prefs.localLon ?? null);
        setLocalCity(prefs.localCity ?? "");
        setTheme(prefs.theme ?? "nightwatch");
        setTimezone(prefs.timezone ?? "America/Chicago");
        setLoaded(true);
      })
      .catch(() => {});
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/auth/gmail-secondary?step=status")
      .then((r) => r.json())
      .then((d: { connected: boolean; email?: string }) => {
        setSecondaryConnected(d.connected);
        setSecondaryEmail(d.email ?? null);
      })
      .catch(() => {});
  }, [open]);

  // Stats feeders for the group headers. OSINT feed-health and AI today's
  // spend both already have child components that fetch them, but those
  // values live in child state — we re-fetch at the parent level so the
  // collapsed headers can show stale-count and dollars-today without
  // requiring the user to expand the group. Cache means the actual HTTP
  // cost is shared with the child.
  const [feedStaleCount, setFeedStaleCount] = useState<number | null>(null);
  const [aiSpendTodayMicros, setAiSpendTodayMicros] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    fetch("/api/osint/feed")
      .then((r) => r.json())
      .then((d) => {
        const feeds: { ok: boolean }[] = Array.isArray(d?.feeds) ? d.feeds : [];
        setFeedStaleCount(feeds.filter((f) => !f.ok).length);
      })
      .catch(() => setFeedStaleCount(null));
    fetch("/api/ai-usage")
      .then((r) => r.json())
      .then((d) => {
        const micros = d?.today?.totalMicros;
        setAiSpendTodayMicros(typeof micros === "number" ? micros : null);
      })
      .catch(() => setAiSpendTodayMicros(null));
  }, [open]);

  const revokeSecondary = async () => {
    setSecondaryRevoking(true);
    await fetch("/api/auth/gmail-secondary?step=revoke", { method: "POST" }).catch(() => {});
    setSecondaryConnected(false);
    setSecondaryEmail(null);
    setSecondaryRevoking(false);
  };

  const handleThemeChange = (t: AppTheme) => {
    setTheme(t);
    applyTheme(t); // instant live preview
  };

  const handleLocationChange = (key: string) => {
    setLocalFeedKey(key);
    const opt = LOCAL_FEED_OPTIONS.find((o) => o.value === key);
    // Snap home to the region's coords ONLY when no custom home is set — otherwise
    // changing the local-news region would wipe out a precise home the user entered.
    if (opt && !localCity.trim()) { setLocalLat(opt.lat); setLocalLon(opt.lon); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/user-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role, priorityTopics, deprioritizeTopics, watchlist,
          vipSenders, muteSenders,
          trackedLocations, marketsWatchlist, osintFeeds, newsletterSources, metarStations,
          disabledNewsSources,
          aiEnabled, aiFeatureToggles,
          localFeedKey,
          localZipcode: "", localCity,
          localLat, localLon,
          theme, timezone,
        }),
      });
      // Wipe the client-side data caches so derived views (email priorities
      // from VIP/mute rules, news sort from topics/watchlist, briefing
      // from role) re-fetch on next visit. Without this, the 10-minute
      // EmailTab cache happily serves stale priorities and a new VIP
      // entry silently doesn't apply until the cache expires.
      clientCache.clear();
      // Fire a custom event so prefetchers (digest, briefing) re-prime
      // immediately. Without this, the digest modal cold-fetches on next
      // open because nothing re-runs the prefetch after the clear.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("dashboard-cache-cleared"));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
      onClose();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-md lg:max-w-lg bg-slate-950 border-l border-slate-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
              <span className="text-slate-400 text-sm">⚙</span>
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200">Preferences</h2>
              <p className="text-[9px] text-slate-600 font-mono">Personalises all AI responses</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <a
              href="/user-guide.html"
              target="_blank"
              rel="noopener noreferrer"
              title="Open the user guide in a new tab"
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2 py-1 rounded-md transition-all"
            >
              <span className="text-sm leading-none">?</span>
              <span className="hidden sm:inline">Guide</span>
            </a>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Quick-jump pill row — sticky to the top of the scroll container.
            Click a pill to open its group AND smooth-scroll to it. Active
            (open) groups get the emerald style. */}
        <div className="flex-shrink-0 border-b border-slate-800 bg-slate-950 px-5 py-2 flex items-center gap-1 overflow-x-auto">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => openAndScrollTo(g.key)}
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-all border flex-shrink-0 ${
                openGroups[g.key]
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                  : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Content — five collapsible groups. Each renders its sections
            linearly inside; the existing section forms haven't changed,
            they've just moved into their categorical home. */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* ─── You ─────────────────────────────────────────────── */}
          <section id="prefs-group-you" className="border border-slate-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup("you")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-slate-500 text-xs w-3 flex-shrink-0">{openGroups.you ? "▾" : "▸"}</span>
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">You</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("you")}</span>
            </button>
            {openGroups.you && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Role / Context
                  </label>
                  <p className="text-[10px] text-slate-600 mb-2">
                    Tailors all AI analysis, briefs, and chat responses to your role
                  </p>
                  <textarea
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    rows={3}
                    placeholder="e.g. Defense policy analyst focused on Indo-Pacific affairs"
                    className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-xs text-slate-200 placeholder-slate-600 resize-none outline-none focus:border-slate-500 transition-colors leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Home Location
                  </label>
                  <p className="text-[10px] text-slate-600 mb-2">
                    Your home base — drives the Weather tab home card, the Morning Brief&apos;s home
                    forecast, and the map center. Search an address, city, or ZIP for a precise point.
                  </p>
                  <HomeLocationEditor
                    feedKey={localFeedKey}
                    city={localCity}
                    lat={localLat}
                    lon={localLon}
                    onSetCustom={(label, la, lo) => { setLocalCity(label); setLocalLat(la); setLocalLon(lo); }}
                    onClearCustom={() => {
                      const opt = LOCAL_FEED_OPTIONS.find((o) => o.value === localFeedKey);
                      setLocalCity("");
                      setLocalLat(opt?.lat ?? null);
                      setLocalLon(opt?.lon ?? null);
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Local News Region
                  </label>
                  <p className="text-[10px] text-slate-600 mb-2">
                    Which regional feeds appear in your local news mix. Also the default home location
                    when you haven&apos;t set a precise one above.
                  </p>
                  <select
                    value={localFeedKey}
                    onChange={(e) => handleLocationChange(e.target.value)}
                    className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-slate-500 transition-colors"
                  >
                    {LOCAL_FEED_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Timezone
                  </label>
                  <p className="text-[10px] text-slate-600 mb-2">
                    Used by the AI assistant when adding calendar events
                  </p>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-slate-500 transition-colors"
                  >
                    {TIMEZONE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label} — {opt.value}</option>
                    ))}
                  </select>
                </div>

                <TagInput
                  label="Priority Topics"
                  description="These topics get surfaced first in briefings and analysis"
                  tags={priorityTopics}
                  onChange={setPriorityTopics}
                  placeholder="China, Space Force, nuclear policy…"
                  accent="emerald"
                />

                <TagInput
                  label="Deprioritise Topics"
                  description="Less emphasis in AI responses"
                  tags={deprioritizeTopics}
                  onChange={setDeprioritizeTopics}
                  placeholder="domestic politics, sports…"
                  accent="red"
                />

                <TagInput
                  label="Watchlist — Keyword Alerts"
                  description="Articles, newsletter bullets, OSINT items, aircraft callsigns, and ship names matching these terms get an ⚑ badge and appear first"
                  tags={watchlist}
                  onChange={setWatchlist}
                  placeholder="hypersonic, AUKUS, INDOPACOM, REACH…"
                  accent="orange"
                />
              </div>
            )}
          </section>

          {/* ─── Connections & appearance ─────────────────────────── */}
          <section id="prefs-group-connections" className="border border-slate-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup("connections")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-slate-500 text-xs w-3 flex-shrink-0">{openGroups.connections ? "▾" : "▸"}</span>
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Connections & appearance</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("connections")}</span>
            </button>
            {openGroups.connections && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
                    Accounts
                  </label>
                  <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3 mb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-none mb-0.5">Primary</p>
                          <p className="text-xs text-slate-300 truncate">{primaryEmail ?? "—"}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => signOut()}
                        className="flex-shrink-0 text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1 rounded-lg transition-all font-mono"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                  <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${secondaryConnected ? "bg-blue-400" : "bg-slate-700"}`} />
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-none mb-0.5">Secondary</p>
                          <p className="text-xs text-slate-300 truncate">
                            {secondaryConnected && secondaryEmail ? secondaryEmail : "Not connected"}
                          </p>
                        </div>
                      </div>
                      {secondaryConnected ? (
                        <button
                          onClick={revokeSecondary}
                          disabled={secondaryRevoking}
                          className="flex-shrink-0 text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1 rounded-lg transition-all font-mono disabled:opacity-40"
                        >
                          {secondaryRevoking ? "Removing…" : "Remove"}
                        </button>
                      ) : (
                        <a
                          href="/api/auth/gmail-secondary?step=initiate"
                          className="flex-shrink-0 text-[11px] text-emerald-500 hover:text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 px-2.5 py-1 rounded-lg transition-all font-mono"
                        >
                          Connect
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <CalendarSubscription />

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Appearance
                  </label>
                  <p className="text-[10px] text-slate-600 mb-3">
                    Theme previews update instantly
                  </p>
                  <ThemeSelector value={theme} onChange={handleThemeChange} />
                </div>
              </div>
            )}
          </section>

          {/* ─── Email rules ──────────────────────────────────────── */}
          <section id="prefs-group-email" className="border border-slate-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup("email")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-slate-500 text-xs w-3 flex-shrink-0">{openGroups.email ? "▾" : "▸"}</span>
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Email rules</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("email")}</span>
            </button>
            {openGroups.email && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <p className="text-[10px] text-slate-600">
                  Force a sender to High or Low priority — bypasses the AI classifier.
                  Use a full address (<code className="text-slate-400">jane@example.com</code>) or a bare domain
                  (<code className="text-slate-400">example.com</code>, also matches subdomains).
                </p>

                <TagInput
                  label="Always High — VIP Senders"
                  description="Inbound mail from these senders is always treated as High priority"
                  tags={vipSenders}
                  onChange={setVipSenders}
                  placeholder="boss@company.com, whitehouse.gov…"
                  accent="emerald"
                />

                <TagInput
                  label="Always Low — Muted Senders"
                  description="Inbound mail from these senders is always pushed to Low (still shown, just demoted)"
                  tags={muteSenders}
                  onChange={setMuteSenders}
                  placeholder="noreply@marketing.com, mailchimp.com…"
                  accent="red"
                />
              </div>
            )}
          </section>

          {/* ─── Content sources ──────────────────────────────────── */}
          <section id="prefs-group-sources" className="border border-slate-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup("sources")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-slate-500 text-xs w-3 flex-shrink-0">{openGroups.sources ? "▾" : "▸"}</span>
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Content sources</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("sources")}</span>
            </button>
            {openGroups.sources && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <TripsEditor />
                <TrackedLocationsEditor
                  value={trackedLocations}
                  onChange={setTrackedLocations}
                  onAddMetar={(s) =>
                    setMetarStations((prev) =>
                      prev.length >= 12 || prev.some((x) => x.icao === s.icao) ? prev : [...prev, s]
                    )
                  }
                />
                <MarketsWatchlistEditor value={marketsWatchlist} onChange={setMarketsWatchlist} />
                <NewsSourcesEditor
                  value={disabledNewsSources}
                  onChange={setDisabledNewsSources}
                  currentLocalKey={localFeedKey}
                />
                <NewsletterSourcesEditor value={newsletterSources} onChange={setNewsletterSources} />
                <MetarStationsEditor value={metarStations} onChange={setMetarStations} />
                <OsintFeedsEditor value={osintFeeds} onChange={setOsintFeeds} />
                <AcledCredentialsEditor />
              </div>
            )}
          </section>

          {/* ─── AI & memory ──────────────────────────────────────── */}
          <section id="prefs-group-ai" className="border border-slate-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup("ai")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-slate-500 text-xs w-3 flex-shrink-0">{openGroups.ai ? "▾" : "▸"}</span>
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">AI & memory</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("ai")}</span>
            </button>
            {openGroups.ai && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <AIControlPanel
                  aiEnabled={aiEnabled}
                  onAiEnabled={setAiEnabled}
                  toggles={aiFeatureToggles}
                  onToggles={setAiFeatureToggles}
                />
                <MemoryPanel />
              </div>
            )}
          </section>
        </div>

        {/* Save footer */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-950">
          <button
            onClick={save}
            disabled={saving}
            className={`w-full flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest py-2.5 rounded-lg transition-all ${
              saved
                ? "bg-emerald-600 text-white"
                : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 glow-green"
            } disabled:opacity-50`}
          >
            {saved ? "✓ Saved" : saving ? "Saving…" : "Save Preferences"}
          </button>
        </div>
      </div>
    </>
  );
}
