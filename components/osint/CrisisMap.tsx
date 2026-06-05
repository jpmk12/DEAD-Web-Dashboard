"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import { AMC_HUBS } from "@/lib/amcHubs";
import type { WeatherThreats } from "@/lib/types";

// Crisis / situation map — fuses the Global Reach Watch data spatially: disaster
// watch (HADR pull), hub weather hazards (reach impede), tropical systems, and
// the AMC hub network, on one dark world map. Optional great-circle reach rings
// answer "which crises are within range of which hub". Coarse SA, not planning.

const HUBS = AMC_HUBS.flatMap((g) => g.hubs);

// Earth radius in nautical miles, for geodesic reach rings.
const EARTH_NM = 3440.065;

// Sample a great-circle circle of `radiusNm` around a point into [lat,lon]
// vertices. A true constant-radius ring is a geodesic (renders as an ellipse on
// the web-Mercator projection); sampling keeps it honest. Longitudes are
// normalized to [-180,180]; rings spanning the antimeridian may show a seam.
function geodesicRing(lat: number, lon: number, radiusNm: number, n = 72): [number, number][] {
  const d = radiusNm / EARTH_NM;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const θ = (i / n) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    out.push([(φ2 * 180) / Math.PI, (((λ2 * 180) / Math.PI + 540) % 360) - 180]);
  }
  return out;
}

const hubIcon = L.divIcon({
  html: `<div style="color:#34d399;font-size:13px;line-height:1;text-shadow:0 0 3px #020617,0 0 3px #020617">✈</div>`,
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});
const tropicalIcon = L.divIcon({
  html: `<div style="font-size:15px;line-height:1">🌀</div>`,
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

type LayerKey = "disasters" | "hubs" | "hazards" | "tropical" | "rings";

const EMPTY: WeatherThreats = {
  threats: [], tropical: [], disasters: [], hazards: [],
  summary: { extreme: 0, severe: 0, lifeThreatening: 0, total: 0, topEvent: null, disasters: 0, disastersRed: 0, hazardLocations: 0 },
};

export default function CrisisMap() {
  const [data, setData] = useState<WeatherThreats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [on, setOn] = useState<Record<LayerKey, boolean>>({
    disasters: true, hubs: true, hazards: true, tropical: true, rings: false,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/weather/threats", { signal: ctrl.signal })
      // r.ok guard so a 401/500 body can't poison the arrays (see ThreatBoard).
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WeatherThreats | null) => setData(d && Array.isArray(d.disasters) ? d : EMPTY))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  const disasters = Array.isArray(data.disasters) ? data.disasters : [];
  const hazards = Array.isArray(data.hazards) ? data.hazards : [];
  const tropical = Array.isArray(data.tropical) ? data.tropical : [];

  const toggle = (k: LayerKey) => setOn((p) => ({ ...p, [k]: !p[k] }));

  const counts = useMemo(
    () => ({ disasters: disasters.length, hazards: hazards.length, tropical: tropical.length, hubs: HUBS.length }),
    [disasters, hazards, tropical],
  );

  const chip = (k: LayerKey, label: string, n?: number, dot?: string) => (
    <button
      onClick={() => toggle(k)}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${
        on[k] ? "bg-violet-500/20 text-violet-200 border-violet-500/40" : "bg-slate-800/80 text-slate-500 border-slate-700/80 hover:text-slate-300"
      }`}
    >
      {dot && <span style={{ color: dot }}>●</span>}
      {label}{typeof n === "number" ? ` ${n}` : ""}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {chip("disasters", "Disasters", counts.disasters, "#f87171")}
        {chip("hazards", "Hub wx", counts.hazards, "#fbbf24")}
        {chip("tropical", "Tropical", counts.tropical, "#38bdf8")}
        {chip("hubs", "AMC hubs", counts.hubs, "#34d399")}
        {chip("rings", "Reach rings")}
        <span className="flex-1" />
        <span className="text-slate-700 font-mono">{loading ? "loading…" : "GDACS · USGS · NWS · NHC"}</span>
      </div>

      <div
        className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden relative h-[58vh] min-h-[360px] lg:h-[600px]"
        style={{ isolation: "isolate", zIndex: 0 }}
      >
        <MapContainer center={[20, 10]} zoom={2} worldCopyJump style={{ height: "100%", width: "100%", background: "#020617" }} scrollWheelZoom>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap &copy; CARTO"
            maxZoom={19}
          />

          {/* Reach rings — illustrative ~2,000 nm radius per hub. */}
          {on.rings && HUBS.map((h) => (
            <Polyline
              key={`ring-${h.icao}`}
              positions={geodesicRing(h.lat, h.lon, 2000)}
              pathOptions={{ color: "#34d399", weight: 1, opacity: 0.25, dashArray: "4 5" }}
            />
          ))}

          {/* AMC hubs */}
          {on.hubs && HUBS.map((h) => (
            <Marker key={`hub-${h.icao}`} position={[h.lat, h.lon]} icon={hubIcon}>
              <Popup>
                <div className="text-[12px] font-mono leading-tight">
                  <div className="font-bold text-sm">{h.name}</div>
                  <div><span className="text-slate-500">ICAO:</span> {h.icao}</div>
                  <div className="text-slate-500">AMC hub / en route node</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Hub weather hazards — halo at the affected tracked point. */}
          {on.hazards && hazards.map((z) => (
            <CircleMarker
              key={`hz-${z.label}`}
              center={[z.lat, z.lon]}
              radius={10}
              pathOptions={{ color: z.severity === "severe" ? "#ef4444" : "#fbbf24", weight: 2, fill: false, opacity: 0.85 }}
            >
              <Popup>
                <div className="text-[12px] font-mono leading-tight">
                  <div className="font-bold text-sm">{z.label}</div>
                  <div className={z.severity === "severe" ? "text-red-600" : "text-amber-600"}>
                    {z.severity === "severe" ? "Severe" : "Elevated"} · next 30 h
                  </div>
                  <div className="text-slate-600">{z.flags.join(" · ")}</div>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Disasters — color by severity, size by HADR relevance. */}
          {on.disasters && disasters.filter((d) => d.lat != null && d.lon != null).map((d) => {
            const hadr = d.hadrScore ?? 0;
            const color = d.severity === "red" ? "#ef4444" : d.severity === "orange" ? "#fb923c" : "#64748b";
            return (
              <CircleMarker
                key={`d-${d.id}`}
                center={[d.lat as number, d.lon as number]}
                radius={hadr >= 55 ? 9 : d.severity === "red" ? 7 : 5}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.55, weight: hadr >= 55 ? 2.5 : 1 }}
              >
                <Popup>
                  <div className="text-[12px] font-mono leading-tight max-w-[240px]">
                    <div className="font-bold text-sm mb-0.5">{d.title}</div>
                    <div className="text-slate-600">{[d.country, d.type].filter(Boolean).join(" · ")}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="px-1 rounded" style={{ background: color, color: "#fff" }}>{d.severity}</span>
                      {d.aor !== "UNKNOWN" && <span className="px-1 rounded bg-sky-100 text-sky-800">{d.aor}</span>}
                      {hadr >= 55 && <span className="px-1 rounded bg-orange-100 text-orange-800">HADR {hadr}</span>}
                      {d.nearLocations.length > 0 && <span className="px-1 rounded bg-red-100 text-red-800">near {d.nearLocations.join(", ")}</span>}
                    </div>
                    {d.link && <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline mt-1 inline-block">open ↗</a>}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          {/* Tropical systems */}
          {on.tropical && tropical.filter((t) => t.lat != null && t.lon != null).map((t) => (
            <Marker key={`t-${t.id}`} position={[t.lat as number, t.lon as number]} icon={tropicalIcon}>
              <Popup>
                <div className="text-[12px] font-mono leading-tight">
                  <div className="font-bold text-sm">{t.category} {t.name}</div>
                  {t.intensityKt != null && <div><span className="text-slate-500">Wind:</span> {t.intensityKt} kt</div>}
                  {t.movement && <div><span className="text-slate-500">Moving:</span> {t.movement}</div>}
                  {t.link && <a href={t.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">NHC ↗</a>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <p className="text-[10px] text-slate-700 leading-relaxed">
        Crisis picture: disaster watch (GDACS/USGS), hub weather hazards (model, next 30 h), tropical systems (NHC),
        and the AMC hub network. Disaster dots are sized by HADR-airlift relevance. Reach rings are a nominal
        ~2,000 nm illustration around each hub — <span className="text-slate-500">not a planning radius</span> (real
        range depends on payload, winds, air refueling, and clearances). Coarse situational awareness, not tasking.
      </p>
    </div>
  );
}
