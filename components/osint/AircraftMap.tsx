"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import MapAOIControls from "./MapAOIControls";

interface Aircraft {
  icao24: string;
  callsign: string;
  country: string;
  lon: number;
  lat: number;
  altitude: number | null;
  onGround: boolean;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  isMilitary: boolean;
}

interface AircraftMapProps {
  homeLat: number;
  homeLon: number;
  radiusKm?: number;
  notableCallsigns?: string[];
}

const REFRESH_MS = 15_000;

function makePlaneIcon(heading: number, color: string, scale = 1): L.DivIcon {
  const size = 22 * scale;
  const html = `
    <div style="transform: rotate(${heading}deg); width: ${size}px; height: ${size}px;">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" stroke="#0f172a" stroke-width="0.5">
        <path d="M12 2 L13.5 9 L22 11 L22 13 L13.5 13.5 L13 18.5 L16 20 L16 21.5 L12 20.5 L8 21.5 L8 20 L11 18.5 L10.5 13.5 L2 13 L2 11 L10.5 9 Z" />
      </svg>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

// One-shot fitBounds when the search params change (initial mount + after the
// user clicks "Search this area"). Doesn't fire on every render.
function FitToSearch({ lat, lon, radiusKm, key: kkey }: { lat: number; lon: number; radiusKm: number; key: string }) {
  const map = useMap();
  useEffect(() => {
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
    map.fitBounds([[lat - latDelta, lon - lonDelta], [lat + latDelta, lon + lonDelta]], { padding: [20, 20] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kkey]);
  return null;
}

// Listens to pan/zoom and reports the current map center + radius back so
// the parent can show a "Search this area" button when the view has drifted
// far enough from the active search bounds to warrant a re-query.
function ViewportTracker({ onChange }: { onChange: (center: L.LatLng, radiusKm: number) => void }) {
  const map = useMapEvents({
    moveend: () => emit(),
    zoomend: () => emit(),
  });
  function emit() {
    const center = map.getCenter();
    const ne = map.getBounds().getNorthEast();
    onChange(center, center.distanceTo(ne) / 1000);
  }
  return null;
}

export default function AircraftMap({ homeLat, homeLon, radiusKm = 250, notableCallsigns = [] }: AircraftMapProps) {
  // Search bounds = what the API is actually fetching for. View bounds = what
  // the user is currently looking at. The "Search this area" button bridges
  // the two when they drift apart.
  const [search, setSearch] = useState({ lat: homeLat, lon: homeLon, radiusKm });
  const [viewCenter, setViewCenter] = useState<L.LatLng | null>(null);
  const [viewRadius, setViewRadius] = useState<number>(radiusKm);

  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [milOnly, setMilOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const fitKeyRef = useRef(0);
  fitKeyRef.current = 0; // re-derive below

  // Re-snap the view to the new search bounds when a search changes — i.e.
  // when the user clicks "Search this area" or props change. Stable key
  // lets FitToSearch detect "real" changes.
  const fitKey = `${search.lat.toFixed(3)}:${search.lon.toFixed(3)}:${search.radiusKm.toFixed(0)}`;

  const notableSet = useMemo(
    () => new Set(notableCallsigns.map((c) => c.trim().toUpperCase()).filter((c) => c.length >= 3)),
    [notableCallsigns],
  );

  // Reset search when home/radius props change (e.g. user updated their AOR
  // in Preferences).
  useEffect(() => {
    setSearch({ lat: homeLat, lon: homeLon, radiusKm });
  }, [homeLat, homeLon, radiusKm]);

  // Poll the proxy whenever the active search changes.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/osint/aircraft?lat=${search.lat}&lon=${search.lon}&radius=${search.radiusKm}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? `HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        setAircraft(Array.isArray(data.aircraft) ? data.aircraft : []);
        setFetchedAt(typeof data.fetchedAt === "number" ? data.fetchedAt : Date.now());
        setError(null);
        setLoading(false);
      } catch {
        if (!cancelled) { setError("Network error"); setLoading(false); }
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [search.lat, search.lon, search.radiusKm]);

  const isNotable = (callsign: string) => callsign && notableSet.has(callsign.toUpperCase());

  const shown = useMemo(() => {
    return aircraft.filter((a) => {
      if (isNotable(a.callsign)) return true;
      if (milOnly && !a.isMilitary) return false;
      return true;
    });
  }, [aircraft, milOnly, notableSet]);

  const notableCount = aircraft.filter((a) => isNotable(a.callsign)).length;

  // Search-here drift detection: show the button if the user has moved the
  // view center >25% of the current radius away from the search center, OR
  // the visible radius differs by >50%. Both thresholds are loose so a
  // pixel-perfect pan doesn't trigger a refetch.
  const drift = useMemo(() => {
    if (!viewCenter) return null;
    const dKm = L.latLng(search.lat, search.lon).distanceTo(viewCenter) / 1000;
    const centerDrift = dKm / search.radiusKm;
    const radiusDrift = Math.abs(viewRadius - search.radiusKm) / search.radiusKm;
    return { centerDrift, radiusDrift };
  }, [viewCenter, viewRadius, search]);
  const showSearchHere = drift && (drift.centerDrift > 0.25 || drift.radiusDrift > 0.5);

  const searchHere = () => {
    if (!viewCenter) return;
    setSearch({
      lat: viewCenter.lat,
      lon: viewCenter.lng,
      radiusKm: Math.max(20, Math.min(500, viewRadius)),
    });
    setLoading(true);
  };

  return (
    <div className="space-y-2">
      {/* Area-of-interest controls: visible above the map, so the user can
          type a city / coords / radius without needing to discover the
          drift-triggered floating button. */}
      <MapAOIControls
        currentRadiusKm={search.radiusKm}
        onApply={(lat, lon, r) => { setSearch({ lat, lon, radiusKm: r }); setLoading(true); }}
        onReset={() => setSearch({ lat: homeLat, lon: homeLon, radiusKm })}
      />
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <span className="text-slate-600 font-mono uppercase tracking-wider mr-1">OpenSky</span>
        <button
          type="button"
          onClick={() => setMilOnly((v) => !v)}
          className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border transition-all ${
            milOnly
              ? "bg-red-500/15 text-red-300 border-red-500/40"
              : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
          }`}
          title="Limit to military aircraft (US Mil ICAO prefixes + common mil callsigns)"
        >
          Mil only
        </button>
        <span className="text-slate-700 font-mono">
          {loading ? "…" : `${shown.length}/${aircraft.length} shown`}
        </span>
        {notableCount > 0 && (
          <span className="text-orange-400 font-mono">
            · ⚑ {notableCount} notable
          </span>
        )}
        <span className="text-slate-700 font-mono">
          · {search.radiusKm.toFixed(0)}km radius
        </span>
        {error && <span className="text-red-400 ml-2">⚠ {error}</span>}
        <span className="flex-1" />
        {fetchedAt && (
          <span className="text-slate-700 font-mono">
            updated {Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000))}s ago
          </span>
        )}
      </div>

      {/* Wrapper isolates Leaflet's z-index hierarchy from the rest of the
          page. Without `isolation: isolate`, popups (z-index 700 by default)
          punch through over the tab nav and any modal/drawer that uses a
          lower z-index. */}
      <div
        className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden relative"
        style={{ height: 600, isolation: "isolate", zIndex: 0 }}
      >
        <MapContainer
          center={[search.lat, search.lon]}
          zoom={8}
          style={{ height: "100%", width: "100%", background: "#020617" }}
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; OpenStreetMap &copy; CARTO'
            maxZoom={19}
          />
          <FitToSearch lat={search.lat} lon={search.lon} radiusKm={search.radiusKm} key={fitKey} />
          <ViewportTracker onChange={(c, r) => { setViewCenter(c); setViewRadius(r); }} />
          <Circle
            center={[search.lat, search.lon]}
            radius={search.radiusKm * 1000}
            pathOptions={{ color: "#10b981", weight: 1, opacity: 0.4, fillOpacity: 0.02 }}
          />
          {shown.map((a) => {
            const notable = isNotable(a.callsign);
            const color = notable ? "#fb923c" : a.isMilitary ? "#ef4444" : "#94a3b8";
            const scale = notable ? 1.3 : a.isMilitary ? 1.1 : 0.85;
            return (
              <Marker
                key={a.icao24 || `${a.lat},${a.lon},${a.callsign}`}
                position={[a.lat, a.lon]}
                icon={makePlaneIcon(a.heading ?? 0, color, scale)}
              >
                <Popup>
                  <div className="text-[12px] font-mono leading-tight">
                    <div className="font-bold text-sm mb-1">
                      {a.callsign || "—"}
                      {notable && <span className="ml-1 text-orange-500">⚑</span>}
                      {a.isMilitary && !notable && <span className="ml-1 text-red-500">MIL</span>}
                    </div>
                    <div><span className="text-slate-500">ICAO:</span> {a.icao24}</div>
                    <div><span className="text-slate-500">Country:</span> {a.country || "—"}</div>
                    <div>
                      <span className="text-slate-500">Alt:</span>{" "}
                      {a.altitude !== null ? `${Math.round(a.altitude * 3.281).toLocaleString()} ft` : "—"}
                    </div>
                    <div>
                      <span className="text-slate-500">Speed:</span>{" "}
                      {a.velocity !== null ? `${Math.round(a.velocity * 1.944)} kn` : "—"}
                    </div>
                    <div>
                      <span className="text-slate-500">Hdg:</span>{" "}
                      {a.heading !== null ? `${Math.round(a.heading)}°` : "—"}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* "Search this area" button — appears when the user has panned/zoomed
            far enough that the current view no longer matches the active
            search bounds. Click to re-query at the new center + radius. */}
        {showSearchHere && (
          <button
            type="button"
            onClick={searchHere}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-[400] bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md shadow-lg transition-all"
            title="Re-query OpenSky at the current map view"
          >
            🔍 Search this area
          </button>
        )}

        {/* Reset-to-home affordance, always available so the user can snap
            back if they've wandered. */}
        <button
          type="button"
          onClick={() => setSearch({ lat: homeLat, lon: homeLon, radiusKm })}
          className="absolute bottom-3 left-3 z-[400] bg-slate-900/85 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-all"
          title="Reset to home location"
        >
          ⌂ Home
        </button>
      </div>

      <p className="text-[10px] text-slate-700 leading-relaxed">
        Live aircraft via OpenSky Network (anonymous tier, 60s server cache).
        Pan / zoom freely, then click <span className="text-emerald-400">🔍 Search this area</span> to re-query at the new center.
        Orange ⚑ markers are callsigns on your watch list. Heading rotated to the live track angle.
      </p>
    </div>
  );
}
