"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";

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

// Plane-shaped DivIcon with rotation by heading. Coloured by category:
//   notable callsign  → orange
//   military          → red
//   civilian          → slate
function makePlaneIcon(heading: number, color: string, scale = 1): L.DivIcon {
  const size = 22 * scale;
  // SVG plane (top-down) — points "up", we rotate the wrapper.
  const html = `
    <div style="transform: rotate(${heading}deg); width: ${size}px; height: ${size}px;">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" stroke="#0f172a" stroke-width="0.5">
        <path d="M12 2 L13.5 9 L22 11 L22 13 L13.5 13.5 L13 18.5 L16 20 L16 21.5 L12 20.5 L8 21.5 L8 20 L11 18.5 L10.5 13.5 L2 13 L2 11 L10.5 9 Z" />
      </svg>
    </div>`;
  return L.divIcon({
    html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

// Lock map view to home + radius on mount. After that the user can pan/zoom
// freely; we don't re-centre on refresh so positioning stays sticky.
function FitToBounds({ lat, lon, radiusKm }: { lat: number; lon: number; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    // Approximate bbox for the requested radius — same math as the server.
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180) || 1);
    map.fitBounds([[lat - latDelta, lon - lonDelta], [lat + latDelta, lon + lonDelta]], { padding: [20, 20] });
    // Only on mount; subsequent prop changes intentionally don't re-fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function AircraftMap({ homeLat, homeLon, radiusKm = 250, notableCallsigns = [] }: AircraftMapProps) {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [milOnly, setMilOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const notableSet = useMemo(() => {
    return new Set(notableCallsigns.map((c) => c.trim().toUpperCase()).filter((c) => c.length >= 3));
  }, [notableCallsigns]);

  // Poll the proxy every REFRESH_MS. Server-side cache means polls during a
  // hot 60-second window cost nothing — we just get the cached state.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/osint/aircraft?lat=${homeLat}&lon=${homeLon}&radius=${radiusKm}`);
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
  }, [homeLat, homeLon, radiusKm]);

  const isNotable = (callsign: string) => callsign && notableSet.has(callsign.toUpperCase());

  const shown = useMemo(() => {
    return aircraft.filter((a) => {
      // Notable callsigns always show through the mil filter.
      if (isNotable(a.callsign)) return true;
      if (milOnly && !a.isMilitary) return false;
      return true;
    });
  }, [aircraft, milOnly, notableSet]);

  const notableCount = aircraft.filter((a) => isNotable(a.callsign)).length;

  return (
    <div className="space-y-2">
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
        {error && <span className="text-red-400 ml-2">⚠ {error}</span>}
        <span className="flex-1" />
        {fetchedAt && (
          <span className="text-slate-700 font-mono">
            updated {Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000))}s ago
          </span>
        )}
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 600 }}>
        <MapContainer
          center={[homeLat, homeLon]}
          zoom={8}
          style={{ height: "100%", width: "100%", background: "#020617" }}
          scrollWheelZoom
        >
          {/* Dark CartoDB tiles match the dashboard's slate aesthetic. */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; OpenStreetMap &copy; CARTO'
            maxZoom={19}
          />
          <FitToBounds lat={homeLat} lon={homeLon} radiusKm={radiusKm} />
          <Circle
            center={[homeLat, homeLon]}
            radius={radiusKm * 1000}
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
      </div>

      <p className="text-[10px] text-slate-700 leading-relaxed">
        Live aircraft via OpenSky Network (anonymous tier, 60s server cache).
        Mil filter uses US Mil ICAO prefixes (AE/AF) + common military
        callsign patterns. Orange ⚑ markers are callsigns on your watch list
        (configure below). Plane heading is rotated to the live track angle.
      </p>
    </div>
  );
}
