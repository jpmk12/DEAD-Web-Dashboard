"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";

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

// Triangle-shaped boat icon, rotated by COG (course over ground). Heading
// would be more accurate where available, but COG is reported on every
// PositionReport while heading is null for many vessels.
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

// Coarse ship-type bucketing per ITU AIS Type codes. Used to colour markers
// and explain the marker on hover.
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

function FitToBounds({ lat, lon, radiusKm }: { lat: number; lon: number; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
    map.fitBounds([[lat - latDelta, lon - lonDelta], [lat + latDelta, lon + lonDelta]], { padding: [20, 20] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function MaritimeMap({ homeLat, homeLon, radiusKm = 200, notableNames = [] }: MaritimeMapProps) {
  const [ships, setShips] = useState<Ship[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const notableSet = useMemo(
    () => new Set(notableNames.map((n) => n.trim().toUpperCase()).filter((n) => n.length >= 3)),
    [notableNames],
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/osint/ships?lat=${homeLat}&lon=${homeLon}&radius=${radiusKm}`);
        const data = await res.json();
        if (cancelled) return;
        setConfigured(!!data.configured);
        setConnected(!!data.connected);
        setError(data.error ?? null);
        setShips(Array.isArray(data.ships) ? data.ships : []);
        setFetchedAt(typeof data.fetchedAt === "number" ? data.fetchedAt : Date.now());
        setLoading(false);
      } catch {
        if (!cancelled) { setError("Network error"); setLoading(false); }
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [homeLat, homeLon, radiusKm]);

  const isNotable = (name: string) => name && notableSet.has(name.toUpperCase());

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <span className="text-slate-600 font-mono uppercase tracking-wider mr-1">AISStream</span>
        {!configured ? (
          <span className="text-amber-400 font-mono">
            Live AIS not configured — set AISSTREAM_API_KEY env var (free signup at aisstream.io)
          </span>
        ) : (
          <>
            <span className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${
              connected
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                : "bg-amber-500/15 text-amber-400 border-amber-500/40"
            }`}>
              {connected ? "Connected" : "Connecting…"}
            </span>
            <span className="text-slate-700 font-mono">
              {loading ? "…" : `${ships.length} ships in range`}
            </span>
            {error && <span className="text-red-400 ml-2">⚠ {error}</span>}
          </>
        )}
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
          zoom={7}
          style={{ height: "100%", width: "100%", background: "#020617" }}
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; OpenStreetMap &copy; CARTO'
            maxZoom={19}
          />
          {/* OpenSeaMap seamarks overlay — chart symbols (buoys, beacons,
              shipping lanes). Renders on top of CARTO base. */}
          <TileLayer
            url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
            attribution='&copy; OpenSeaMap'
            opacity={0.85}
          />
          <FitToBounds lat={homeLat} lon={homeLon} radiusKm={radiusKm} />
          <Circle
            center={[homeLat, homeLon]}
            radius={radiusKm * 1000}
            pathOptions={{ color: "#10b981", weight: 1, opacity: 0.4, fillOpacity: 0.02 }}
          />
          {ships.map((s) => {
            const notable = isNotable(s.name);
            const typeInfo = shipTypeLabel(s.shipType);
            const color = notable ? "#fb923c" : typeInfo.color;
            const scale = notable ? 1.5 : 1;
            // Prefer true heading over COG when present.
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
      </div>

      <p className="text-[10px] text-slate-700 leading-relaxed">
        Live AIS via AISStream (server-side WebSocket; 200km radius around your home).
        Base: dark CartoDB tiles + OpenSeaMap seamarks overlay. Markers coloured by
        ship type — orange ⚑ are vessels whose name matches your watch list.
        {!configured && " Free signup at aisstream.io issues an API key; set as AISSTREAM_API_KEY in the platform env to enable."}
      </p>
    </div>
  );
}
