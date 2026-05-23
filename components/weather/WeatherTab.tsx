"use client";

import { useEffect, useState } from "react";

type Overlay = "wind" | "rain" | "temp" | "clouds" | "pressure";

const OVERLAYS: { id: Overlay; label: string; icon: string }[] = [
  { id: "wind",     label: "Wind",     icon: "〜" },
  { id: "rain",     label: "Rain",     icon: "◦" },
  { id: "temp",     label: "Temp",     icon: "◎" },
  { id: "clouds",   label: "Clouds",   icon: "◌" },
  { id: "pressure", label: "Pressure", icon: "◉" },
];

type LocationPreset = { label: string; lat: number; lon: number; zoom: number };

const BASE_LOCATIONS: LocationPreset[] = [
  { label: "CONUS",      lat: 38.5,   lon: -96.0,  zoom: 4 },
  { label: "Colorado",   lat: 38.85,  lon: -104.8, zoom: 7 },
  { label: "DC Metro",   lat: 38.9,   lon: -77.0,  zoom: 8 },
  { label: "Gulf Coast", lat: 29.5,   lon: -90.0,  zoom: 6 },
  { label: "Pacific",    lat: 25.0,   lon: -160.0, zoom: 4 },
  { label: "Europe",     lat: 49.5,   lon: 8.0,    zoom: 5 },
];

const METAR_LINKS = [
  { icao: "KCOS", label: "Peterson/CSAF (CO)" },
  { icao: "KADW", label: "Andrews AFB (MD)" },
  { icao: "KNGU", label: "Norfolk NAS (VA)" },
  { icao: "KFAF", label: "Langley AFB (VA)" },
  { icao: "KLCH", label: "Barksdale AFB (LA)" },
  { icao: "KDYS", label: "Dyess AFB (TX)" },
  { icao: "PHIK", label: "Hickam AFB (HI)" },
  { icao: "RODN", label: "Kadena AB (JPN)" },
];

function buildWindyUrl(lat: number, lon: number, zoom: number, overlay: Overlay): string {
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lon),
    detailLat: String(lat), detailLon: String(lon),
    zoom: String(zoom), level: "surface", overlay,
    product: "ecmwf", message: "true", pressure: "true",
    type: "map", location: "coordinates",
    metricWind: "default", metricTemp: "default", radarRange: "-1",
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function WeatherTab() {
  const [overlay, setOverlay] = useState<Overlay>("wind");
  const [locations, setLocations] = useState<LocationPreset[]>(BASE_LOCATIONS);
  const [loc, setLoc] = useState<LocationPreset>(BASE_LOCATIONS[0]);
  const [src, setSrc] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  // Load user prefs — if lat/lon are stored (from dropdown selection), inject a Home preset
  useEffect(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        const lat = prefs?.localLat;
        const lon = prefs?.localLon;
        if (lat && lon) {
          // Derive a label from the feed key
          const FEED_LABELS: Record<string, string> = {
            colorado: "Colorado", dc: "DC Metro", hampton_roads: "Hampton Roads",
            illinois: "Illinois", new_jersey: "New Jersey", oklahoma: "Oklahoma",
            san_antonio: "San Antonio", hawaii: "Hawaii", japan: "Okinawa", germany: "Ramstein",
          };
          const home: LocationPreset = {
            label: FEED_LABELS[prefs.localFeedKey as string] ?? "Home",
            lat, lon, zoom: 8,
          };
          setLocations([home, ...BASE_LOCATIONS]);
          setLoc(home);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const base = buildWindyUrl(loc.lat, loc.lon, loc.zoom, overlay);
    setSrc(refreshKey > 0 ? `${base}&_r=${refreshKey}` : base);
  }, [loc, overlay, refreshKey]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-sky-400 text-xs">〜</span>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Weather</h2>
            <p className="text-[10px] text-slate-600 font-mono">Meteorological overview — Windy ECMWF model</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-700 font-mono">{formatUpdated(lastUpdated)}</span>
          <button
            onClick={() => { setRefreshKey((k) => k + 1); setLastUpdated(new Date()); }}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 font-mono transition-colors"
          >
            <span className="text-base leading-none">↻</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Overlay selector */}
        <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-lg p-1">
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              onClick={() => setOverlay(o.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
                overlay === o.id
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span>{o.icon}</span>
              <span className="hidden sm:inline">{o.label}</span>
            </button>
          ))}
        </div>

        {/* Location presets */}
        <div className="flex items-center gap-1 flex-wrap">
          {locations.map((l) => (
            <button
              key={l.label}
              onClick={() => setLoc(l)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                loc.label === l.label
                  ? "bg-slate-700 text-slate-200 border border-slate-600"
                  : "text-slate-600 hover:text-slate-400 hover:bg-slate-800/50"
              }`}
            >
              {l.label === locations[0].label && locations[0].label !== "CONUS" ? `⌂ ${l.label}` : l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Windy embed */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 520 }}>
        {src ? (
          <iframe
            src={src}
            width="100%"
            height="100%"
            frameBorder="0"
            allow="geolocation"
            title="Windy weather map"
            className="block"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-slate-600 text-xs font-mono">Loading map…</span>
          </div>
        )}
      </div>

      {/* METAR quick links */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">METAR / TAF — Quick Links</h3>
        <div className="flex flex-wrap gap-2">
          {METAR_LINKS.map(({ icao, label }) => (
            <a
              key={icao}
              href={`https://metar-taf.com/${icao}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`METAR/TAF for ${label}`}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-md transition-all group"
            >
              <span className="text-[10px] font-mono font-bold text-slate-300 group-hover:text-white">{icao}</span>
              <span className="text-[9px] text-slate-600 group-hover:text-slate-400 hidden sm:inline">{label}</span>
            </a>
          ))}
          <a
            href="https://aviationweather.gov/sigmet"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-md transition-all"
          >
            <span className="text-[10px] font-mono font-bold text-amber-400">SIGMET</span>
          </a>
        </div>
      </div>

      {/* Attribution */}
      <p className="text-[10px] text-slate-700 text-right">
        Weather data by{" "}
        <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline transition-colors">Windy.com
        </a>
        {" / ECMWF · METAR via "}
        <a href="https://metar-taf.com" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline transition-colors">metar-taf.com
        </a>
      </p>
    </div>
  );
}
