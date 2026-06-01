"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import MapAOIControls from "./MapAOIControls";

interface Ship {
  mmsi: number;
  name: string;
  shipType: number;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number | null;
  updatedAt: number;
}

interface MaritimeMapProps {
  homeLat: number;
  homeLon: number;
  radiusKm?: number;
  notableNames?: string[];
}

const REFRESH_MS = 15_000;

function makeShipIcon(rotation: number, color: string, scale = 1): L.DivIcon {
  const size = 14 * scale;
  const html = `
    <div style="transform: rotate(${rotation}deg); width: ${size}px; height: ${size}px;">
      <svg viewBox="0 0 12 12" width="${size}" height="${size}" fill="${color}" stroke="#0f172a" stroke-width="0.6">
        <path d="M6 0 L11 11 L6 9 L1 11 Z" />
      </svg>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function shipTypeLabel(type: number): { label: string; color: string } {
  if (type === 0)                       return { label: "Unknown",   color: "#94a3b8" };
  if (type >= 30 && type <= 39)         return { label: "Fishing",   color: "#22d3ee" };
  if (type >= 40 && type <= 49)         return { label: "HSC",       color: "#a78bfa" };
  if (type >= 60 && type <= 69)         return { label: "Passenger", color: "#34d399" };
  if (type >= 70 && type <= 79)         return { label: "Cargo",     color: "#facc15" };
  if (type >= 80 && type <= 89)         return { label: "Tanker",    color: "#fb923c" };
  if (type >= 50 && type <= 59)         return { label: "Special",   color: "#f472b6" };
  return { label: `Type ${type}`,       color: "#94a3b8" };
}

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

export default function MaritimeMap({ homeLat, homeLon, radiusKm = 200, notableNames = [] }: MaritimeMapProps) {
  const [search, setSearch] = useState({ lat: homeLat, lon: homeLon, radiusKm });
  const [viewCenter, setViewCenter] = useState<L.LatLng | null>(null);
  const [viewRadius, setViewRadius] = useState<number>(radiusKm);

  const [ships, setShips] = useState<Ship[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const fitKey = `${search.lat.toFixed(3)}:${search.lon.toFixed(3)}:${search.radiusKm.toFixed(0)}`;

  const notableSet = useMemo(
    () => new Set(notableNames.map((n) => n.trim().toUpperCase()).filter((n) => n.length >= 3)),
    [notableNames],
  );

  useEffect(() => {
    setSearch({ lat: homeLat, lon: homeLon, radiusKm });
  }, [homeLat, homeLon, radiusKm]);

  const failCount = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/osint/ships?lat=${search.lat}&lon=${search.lon}&radius=${search.radiusKm}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        failCount.current = 0;
        setConfigured(!!data.configured);
        setConnected(!!data.connected);
        setError(data.error ?? null);
        setShips(Array.isArray(data.ships) ? data.ships : []);
        setFetchedAt(typeof data.fetchedAt === "number" ? data.fetchedAt : Date.now());
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        failCount.current += 1;
        console.error("[MaritimeMap] ships fetch failed:", e);
        // Tolerate a transient blip — only surface after repeated failures, and
        // keep any vessels already on the map rather than blanking it.
        if (failCount.current >= 2) setError("Live AIS feed unreachable — retrying…");
        setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [search.lat, search.lon, search.radiusKm]);

  const isNotable = (name: string) => name && notableSet.has(name.toUpperCase());

  const drift = useMemo(() => {
    if (!viewCenter) return null;
    const dKm = L.latLng(search.lat, search.lon).distanceTo(viewCenter) / 1000;
    return {
      centerDrift: dKm / search.radiusKm,
      radiusDrift: Math.abs(viewRadius - search.radiusKm) / search.radiusKm,
    };
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
      <MapAOIControls
        currentRadiusKm={search.radiusKm}
        onApply={(lat, lon, r) => { setSearch({ lat, lon, radiusKm: r }); setLoading(true); }}
        onReset={() => setSearch({ lat: homeLat, lon: homeLon, radiusKm })}
      />
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <span className="text-slate-600 font-mono uppercase tracking-wider mr-1">AISStream</span>
        {configured && (
          <span className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${
            connected
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
              : error
              ? "bg-red-500/15 text-red-400 border-red-500/40"
              : "bg-amber-500/15 text-amber-400 border-amber-500/40"
          }`}>
            {connected ? "Connected" : error ? "Disconnected" : "Connecting…"}
          </span>
        )}
        {configured && (
          <span className="text-slate-700 font-mono">
            {loading ? "…" : `${ships.length} ships in range`}
          </span>
        )}
        <span className="text-slate-700 font-mono">
          · {search.radiusKm.toFixed(0)}km radius
        </span>
        {error && configured && <span className="text-red-400 ml-2">⚠ {error}</span>}
        <span className="flex-1" />
        {fetchedAt && configured && (
          <span className="text-slate-700 font-mono">
            updated {Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000))}s ago
          </span>
        )}
      </div>

      <div
        className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden relative"
        style={{ height: 600, isolation: "isolate", zIndex: 0 }}
      >
        <MapContainer
          center={[search.lat, search.lon]}
          zoom={7}
          style={{ height: "100%", width: "100%", background: "#020617" }}
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; OpenStreetMap &copy; CARTO'
            maxZoom={19}
          />
          <TileLayer
            url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
            attribution='&copy; OpenSeaMap'
            opacity={0.85}
          />
          <FitToSearch lat={search.lat} lon={search.lon} radiusKm={search.radiusKm} key={fitKey} />
          <ViewportTracker onChange={(c, r) => { setViewCenter(c); setViewRadius(r); }} />
          <Circle
            center={[search.lat, search.lon]}
            radius={search.radiusKm * 1000}
            pathOptions={{ color: "#10b981", weight: 1, opacity: 0.4, fillOpacity: 0.02 }}
          />
          {ships.map((s) => {
            const notable = isNotable(s.name);
            const typeInfo = shipTypeLabel(s.shipType);
            const color = notable ? "#fb923c" : typeInfo.color;
            const scale = notable ? 1.5 : 1;
            const rotation = s.heading ?? s.cog ?? 0;
            return (
              <Marker
                key={s.mmsi}
                position={[s.lat, s.lon]}
                icon={makeShipIcon(rotation, color, scale)}
              >
                <Popup>
                  <div className="text-[12px] font-mono leading-tight">
                    <div className="font-bold text-sm mb-1">
                      {s.name || `MMSI ${s.mmsi}`}
                      {notable && <span className="ml-1 text-orange-500">⚑</span>}
                    </div>
                    <div><span className="text-slate-500">Type:</span> {typeInfo.label}</div>
                    <div><span className="text-slate-500">MMSI:</span> {s.mmsi}</div>
                    <div><span className="text-slate-500">Speed:</span> {s.sog.toFixed(1)} kn</div>
                    <div><span className="text-slate-500">Course:</span> {Math.round(s.cog)}°</div>
                    {s.heading !== null && (
                      <div><span className="text-slate-500">Heading:</span> {Math.round(s.heading)}°</div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* "Search this area" — re-quires AISStream to re-subscribe to the
            new bbox. Server-side handles re-subscription without dropping
            the WebSocket connection. */}
        {showSearchHere && configured && (
          <button
            type="button"
            onClick={searchHere}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-[400] bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md shadow-lg transition-all"
            title="Re-subscribe to AISStream at the current map view"
          >
            🔍 Search this area
          </button>
        )}

        <button
          type="button"
          onClick={() => setSearch({ lat: homeLat, lon: homeLon, radiusKm })}
          className="absolute bottom-3 left-3 z-[400] bg-slate-900/85 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-all"
          title="Reset to home location"
        >
          ⌂ Home
        </button>

        {/* Big, unmissable banner when no API key is configured. Sits on top
            of the map (above all Leaflet z-indexes within the isolated
            stacking context) so the user can't miss the action item. */}
        {!configured && !loading && (
          <div className="absolute inset-x-3 top-3 z-[500] bg-slate-900/95 border border-amber-500/40 rounded-lg p-3 shadow-lg">
            <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1">
              ⚠ Live AIS not configured
            </p>
            <p className="text-[11px] text-slate-300 leading-snug">
              Live ship tracking needs an AISStream API key. Sign up free at{" "}
              <a
                href="https://aisstream.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline hover:text-emerald-300"
              >
                aisstream.io
              </a>
              , then set <code className="text-emerald-400">AISSTREAM_API_KEY</code> in the platform's environment variables and restart the app.
            </p>
            <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">
              Until then the base nautical chart shows but vessel markers stay empty. The Iframe provider source above still works for live AIS via VesselFinder / MarineTraffic.
            </p>
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate-700 leading-relaxed">
        Live AIS via AISStream (server-side WebSocket). Pan / zoom freely, then
        click <span className="text-emerald-400">🔍 Search this area</span> to re-subscribe.
        Base: CartoDB dark + OpenSeaMap seamarks. Orange ⚑ markers match your watch list.
      </p>
    </div>
  );
}
