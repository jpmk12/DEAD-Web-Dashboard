"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TrackedLocation, StationWx, WeatherThreats, LocationHazard } from "@/lib/types";
import LocationCard from "./LocationCard";
import ThreatBoard, { type ThreatPoint } from "./ThreatBoard";
import SpaceWeatherCard from "./SpaceWeatherCard";
import SpaceWxThreatRow from "./SpaceWxThreatRow";
import AirfieldsByCommand, { type RegAirfield } from "./AirfieldsByCommand";
import WeatherSources, { type SourceStatuses } from "./WeatherSources";
import { CloudSun } from "@/lib/icons";
import { openTrackPicker, postTrack } from "@/lib/trackClient";

// The Weather tab (rebuilt 2026-10-06, REVIEW-2026-10 §8): header + the
// sources strip → Places (where you are · home · civil points, with ＋/✕)
// → My airfields by combatant command → Threats & disasters by command →
// the map, which follows the selected place OR airfield → space weather in
// one sentence. Places and airfields are edited HERE through the one Track
// command; the feeds are named, never edited.

type Overlay = "radar" | "wind" | "rain" | "temp" | "clouds" | "pressure";

const OVERLAYS: { id: Overlay; label: string; icon: string }[] = [
  { id: "radar",    label: "Radar",    icon: "⊚" },
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

interface Sel { label: string; lat: number; lon: number }

export default function WeatherTab() {
  const [overlay, setOverlay] = useState<Overlay>("radar");
  const [home, setHome] = useState<TrackedLocation | null>(null);
  const [trip, setTrip] = useState<TrackedLocation | null>(null);
  const [extras, setExtras] = useState<TrackedLocation[]>([]);
  const [airfields, setAirfields] = useState<RegAirfield[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [stations, setStations] = useState<Record<string, StationWx>>({});
  const [awcDown, setAwcDown] = useState(false);
  const [metarLoading, setMetarLoading] = useState(false);
  const [hazards, setHazards] = useState<LocationHazard[]>([]);
  const [selected, setSelected] = useState<Sel | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());
  const [src, setSrc] = useState<SourceStatuses>({ nws: "idle", openMeteo: "idle", awc: "idle", nhc: "idle", disasters: "idle", swpc: "idle" });
  const [cardSeen, setCardSeen] = useState<{ nws: boolean; openMeteo: boolean; any: boolean }>({ nws: false, openMeteo: false, any: false });

  // Places (home + civil points) from prefs; airfields from the registry.
  // Both re-read on tracking:changed (a ＋/✕ here, a Track anywhere) and on
  // the Preferences / Apply signal.
  const hydrate = useCallback(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        if (prefs?.localLat && prefs?.localLon) {
          setHome({ id: "home", label: (prefs.localCity as string)?.trim() || FEED_LABELS[prefs.localFeedKey as string] || "Home", lat: prefs.localLat, lon: prefs.localLon });
        } else setHome(null);
        setExtras(Array.isArray(prefs?.trackedLocations) ? prefs.trackedLocations : []);
      })
      .catch(() => {});
    fetch("/api/track")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.registry) return;
        setCanEdit(!!d.canEdit);
        setAirfields((d.registry.airfields as RegAirfield[]).filter((a) => a.icao));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    hydrate();
    window.addEventListener("dashboard-cache-cleared", hydrate);
    window.addEventListener("tracking:changed", hydrate);
    return () => { window.removeEventListener("dashboard-cache-cleared", hydrate); window.removeEventListener("tracking:changed", hydrate); };
  }, [hydrate]);

  useEffect(() => {
    fetch("/api/trips")
      .then((r) => r.json())
      .then((d: { active?: { label: string; lat: number; lon: number } | null }) => {
        if (d?.active) setTrip({ id: "trip", label: `${d.active.label} (TDY)`, lat: d.active.lat, lon: d.active.lon });
        else setTrip(null);
      })
      .catch(() => {});
  }, [refreshKey]);

  // METAR/TAF for every registry airfield (the route takes 12 per call).
  useEffect(() => {
    const icaos = [...new Set(airfields.map((a) => a.icao))];
    if (icaos.length === 0) { setStations({}); setSrc((s) => ({ ...s, awc: "na" })); return; }
    setMetarLoading(true);
    const ctrl = new AbortController();
    const chunks: string[][] = [];
    for (let i = 0; i < icaos.length; i += 12) chunks.push(icaos.slice(i, i + 12));
    Promise.all(chunks.map((c) => fetch(`/api/weather/metar?ids=${encodeURIComponent(c.join(","))}&xwind=1`, { signal: ctrl.signal }).then((r) => r.json()).catch(() => null)))
      .then((parts) => {
        const merged: Record<string, StationWx> = {};
        let ok = false;
        for (const p of parts) { if (p?.stations) Object.assign(merged, p.stations); if (p?.ok) ok = true; }
        setStations(merged);
        setAwcDown(!ok);
        setSrc((s) => ({ ...s, awc: ok ? "ok" : "down" }));
      })
      .finally(() => setMetarLoading(false));
    return () => ctrl.abort();
  }, [airfields, refreshKey]);

  const places = useMemo(() => [trip, home, ...extras].filter((l): l is TrackedLocation => l !== null), [trip, home, extras]);
  const points = useMemo<ThreatPoint[]>(() => [
    ...places.map((p) => ({ label: p.label, lat: p.lat, lon: p.lon })),
    ...airfields.filter((a) => a.lat || a.lon).map((a) => ({ label: a.icao, lat: a.lat, lon: a.lon })),
  ], [places, airfields]);

  // The map follows whatever was picked last — a place card or an airfield
  // card; default to where you are.
  const mapSel: Sel | null = selected ?? (places[0] ? { label: places[0].label, lat: places[0].lat, lon: places[0].lon } : null);
  const mapSrc = mapSel ? `${buildWindyUrl(mapSel.lat, mapSel.lon, 8, overlay)}${refreshKey > 0 ? `&_r=${refreshKey}` : ""}` : "";

  const onCardLoaded = useCallback((r: { nws: boolean; openMeteo: boolean }) => {
    setCardSeen((c) => ({ nws: c.nws || r.nws, openMeteo: c.openMeteo || r.openMeteo, any: true }));
  }, []);
  useEffect(() => {
    if (!cardSeen.any) return;
    setSrc((s) => ({ ...s, nws: cardSeen.nws ? "ok" : "na", openMeteo: cardSeen.openMeteo ? "ok" : "down" }));
  }, [cardSeen]);

  const onThreatsLoaded = useCallback((r: { ok: boolean; data: WeatherThreats }) => {
    setHazards(Array.isArray(r.data.hazards) ? r.data.hazards : []);
    setSrc((s) => ({ ...s, nhc: r.ok ? "ok" : "down", disasters: r.ok ? "ok" : "down" }));
  }, []);

  const removePlace = (loc: TrackedLocation) => postTrack({ kind: "place", label: loc.label, lat: loc.lat, lon: loc.lon, remove: true });

  const commandsWithFields = new Set(airfields.map((a) => a.aor)).size;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
            <CloudSun size={15} strokeWidth={2.25} className="text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Weather</h2>
            <p className="text-[10px] text-slate-600 font-mono">
              {places.length} place{places.length === 1 ? "" : "s"} · {airfields.length} airfield{airfields.length === 1 ? "" : "s"} · {commandsWithFields} command{commandsWithFields === 1 ? "" : "s"} · {formatUpdated(lastUpdated)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" disabled={!canEdit} onClick={() => openTrackPicker({ kind: "place" })} className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40">＋ Place</button>
          <button type="button" disabled={!canEdit} onClick={() => openTrackPicker({ kind: "airfield" })} className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border border-slate-600 text-slate-300 hover:border-emerald-500/50 disabled:opacity-40">＋ Airfield</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("prefs:open", { detail: "mission" }))} className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border border-dashed border-slate-700 text-slate-400 hover:text-slate-200" title="Preferences → Mission → What you track">manage ▾</button>
          <button onClick={() => { setRefreshKey((k) => k + 1); setLastUpdated(new Date()); setCardSeen({ nws: false, openMeteo: false, any: false }); }}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 font-mono transition-colors">
            <span className="text-base leading-none">↻</span>Refresh
          </button>
        </div>
      </div>

      <WeatherSources status={src} />

      {/* Places — where you are · home · civil points */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-slate-800">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">◎ Places</h3>
          <span className="text-[10px] text-slate-600">where you are · home · civil points you track (forecast cards — not bases)</span>
          <button type="button" disabled={!canEdit} onClick={() => openTrackPicker({ kind: "place" })} className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:border-emerald-500/50 disabled:opacity-40">＋ Place</button>
        </div>
        {places.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 p-3">
            {places.map((loc) => (
              <LocationCard
                key={`${loc.id}-${refreshKey}`}
                location={loc}
                active={mapSel?.label === loc.label}
                onSelect={() => setSelected({ label: loc.label, lat: loc.lat, lon: loc.lon })}
                tag={loc.id === "home" ? "home" : loc.id === "trip" ? "tdy" : undefined}
                onRemove={canEdit && loc.id !== "home" && loc.id !== "trip" ? () => removePlace(loc) : undefined}
                onLoaded={onCardLoaded}
              />
            ))}
            {canEdit && (
              <button type="button" onClick={() => openTrackPicker({ kind: "place" })} className="min-h-[120px] rounded-xl border border-dashed border-slate-700 text-[11px] text-slate-500 hover:text-emerald-300 hover:border-emerald-500/40">＋ Add a place — city, ZIP or coordinates</button>
            )}
          </div>
        ) : (
          <p className="px-4 py-5 text-xs text-slate-500 font-mono">
            No places yet. Set a home in <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("prefs:open", { detail: "you" }))} className="text-emerald-400 hover:underline">Preferences → You → Home Location</button>, or <button type="button" onClick={() => openTrackPicker({ kind: "place" })} className="text-emerald-400 hover:underline">＋ Place</button>.
          </p>
        )}
      </div>

      {/* My airfields, by combatant command */}
      <AirfieldsByCommand airfields={airfields} stations={stations} awcDown={awcDown} loading={metarLoading} hazards={hazards}
        selectedLabel={mapSel?.label ?? null} onSelect={(p) => setSelected(p)} canEdit={canEdit} />

      {/* Threats & disasters, by combatant command */}
      <ThreatBoard refreshKey={refreshKey} points={points} onLoaded={onThreatsLoaded} />
      <SpaceWxThreatRow refreshKey={refreshKey} />

      {/* Map — follows the selected place or airfield */}
      {mapSel && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-slate-800">
            <div className="flex items-center gap-1 bg-slate-950/60 border border-slate-800 rounded-lg p-1">
              {OVERLAYS.map((o) => (
                <button key={o.id} onClick={() => setOverlay(o.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${overlay === o.id ? "bg-sky-500/20 text-sky-300 border border-sky-500/40" : "text-slate-500 hover:text-slate-300"}`}>
                  <span>{o.icon}</span><span className="hidden sm:inline">{o.label}</span>
                </button>
              ))}
            </div>
            <span className="text-[10px] text-slate-600 font-mono">centred on <span className="text-slate-300">{mapSel.label}</span> — follows the selected place or airfield</span>
          </div>
          <div style={{ height: 480 }}>
            <iframe src={mapSrc} width="100%" height="100%" frameBorder="0" allow="geolocation" title="Windy weather map" className="block" />
          </div>
        </div>
      )}

      <SpaceWeatherCard onLoaded={(ok) => setSrc((s) => ({ ...s, swpc: ok ? "ok" : "down" }))} />

      <p className="text-[10px] text-slate-700 text-right">
        Weather by <a href="https://www.weather.gov" target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-400 underline">NWS</a>
        {" · "}<a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-400 underline">Open-Meteo</a>
        {" · "}<a href="https://aviationweather.gov" target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-400 underline">AWC</a>
        {" · space weather by "}<a href="https://www.swpc.noaa.gov" target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-400 underline">NOAA SWPC</a>
        {" · map by "}<a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-400 underline">Windy.com</a>
      </p>
    </div>
  );
}
