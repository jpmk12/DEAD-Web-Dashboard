"use client";

import { useEffect, useMemo, useState } from "react";
import { TrackedLocation, MetarStation } from "@/lib/types";
import LocationCard from "./LocationCard";
import ThreatBoard from "./ThreatBoard";
import SpaceWeatherCard from "./SpaceWeatherCard";
import MetarPanel from "./MetarPanel";
import { CloudSun } from "@/lib/icons";

type Overlay = "wind" | "rain" | "temp" | "clouds" | "pressure";

const OVERLAYS: { id: Overlay; label: string; icon: string }[] = [
  { id: "wind",     label: "Wind",     icon: "〜" },
  { id: "rain",     label: "Rain",     icon: "◦" },
  { id: "temp",     label: "Temp",     icon: "◎" },
  { id: "clouds",   label: "Clouds",   icon: "◌" },
  { id: "pressure", label: "Pressure", icon: "◉" },
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

const FEED_LABELS: Record<string, string> = {
  colorado: "Colorado", dc: "DC Metro", hampton_roads: "Hampton Roads",
  illinois: "Illinois", new_jersey: "New Jersey", oklahoma: "Oklahoma",
  san_antonio: "San Antonio", hawaii: "Hawaii", japan: "Okinawa", germany: "Ramstein",
};

export default function WeatherTab() {
  const [overlay, setOverlay] = useState<Overlay>("wind");
  const [home, setHome] = useState<TrackedLocation | null>(null);
  const [extras, setExtras] = useState<TrackedLocation[]>([]);
  const [metarStations, setMetarStations] = useState<MetarStation[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  // Hydrate the location set from user prefs. Home is the localLat/localLon
  // already there; extras are the trackedLocations field added this push.
  useEffect(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        if (prefs?.localLat && prefs?.localLon) {
          setHome({
            id: "home",
            label: FEED_LABELS[prefs.localFeedKey as string] ?? "Home",
            lat: prefs.localLat,
            lon: prefs.localLon,
          });
        }
        if (Array.isArray(prefs?.trackedLocations)) setExtras(prefs.trackedLocations);
        if (Array.isArray(prefs?.metarStations)) setMetarStations(prefs.metarStations);
      })
      .catch(() => {});
  }, []);

  const allLocations = useMemo(
    () => (home ? [home, ...extras] : extras),
    [home, extras]
  );

  const selected = allLocations[selectedIdx] ?? home ?? null;
  const mapSrc = selected
    ? `${buildWindyUrl(selected.lat, selected.lon, 8, overlay)}${refreshKey > 0 ? `&_r=${refreshKey}` : ""}`
    : "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
            <CloudSun size={15} strokeWidth={2.25} className="text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Weather</h2>
            <p className="text-[10px] text-slate-600 font-mono">
              {allLocations.length} location{allLocations.length === 1 ? "" : "s"} · NWS · NOAA SWPC
            </p>
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

      {/* Multi-location grid */}
      {allLocations.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {allLocations.map((loc, i) => (
            <LocationCard
              key={loc.id}
              location={loc}
              active={i === selectedIdx}
              onSelect={() => setSelectedIdx(i)}
            />
          ))}
        </div>
      )}

      {allLocations.length === 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 text-center">
          <p className="text-xs text-slate-500 font-mono">
            No locations configured. Set a home location in <span className="text-emerald-400">Preferences → Local Area</span> or
            add tracked locations under <span className="text-emerald-400">Tracked Locations</span>.
          </p>
        </div>
      )}

      {/* Severe-weather threat board (alerts across all locations + tropical systems) */}
      <ThreatBoard refreshKey={refreshKey} />

      {/* Map controls + Windy embed centred on the selected location */}
      {selected && (
        <>
          <div className="flex flex-wrap items-center gap-3 pt-2">
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
            <span className="text-[10px] text-slate-600 font-mono">
              Map centred on <span className="text-slate-300">{selected.label}</span>
            </span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 480 }}>
            <iframe
              src={mapSrc}
              width="100%"
              height="100%"
              frameBorder="0"
              allow="geolocation"
              title="Windy weather map"
              className="block"
            />
          </div>
        </>
      )}

      {/* Decoded METAR / TAF for configured airfields */}
      <MetarPanel stations={metarStations} refreshKey={refreshKey} />

      {/* Space weather — kept at the bottom of the tab */}
      <SpaceWeatherCard />

      <p className="text-[10px] text-slate-700 text-right">
        Weather data by{" "}
        <a href="https://www.weather.gov" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline">NWS</a>
        {" · space weather by "}
        <a href="https://www.swpc.noaa.gov" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline">NOAA SWPC</a>
        {" · map by "}
        <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline">Windy.com</a>
      </p>
    </div>
  );
}
