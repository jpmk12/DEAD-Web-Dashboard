"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { Incident } from "@/lib/groundTruth";

const incIcon = L.divIcon({ html: `<div style="color:#ef4444;font-size:12px;line-height:1;text-shadow:0 0 3px #020617">◆</div>`, className: "", iconSize: [14, 14], iconAnchor: [7, 7] });
const baseIcon = L.divIcon({ html: `<div style="font-size:14px;line-height:1;text-shadow:0 0 3px #020617">🛡</div>`, className: "", iconSize: [16, 16], iconAnchor: [8, 8] });

function FitBounds({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    // The tab may have been hidden (display:none → 0×0) when the map mounted;
    // recompute size before fitting.
    map.invalidateSize();
    const valid = pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (valid.length === 0) return;
    if (valid.length === 1) { map.setView(valid[0], 6); return; }
    map.fitBounds(L.latLngBounds(valid), { padding: [22, 22], maxZoom: 7 });
  }, [pts, map]);
  return null;
}

export default function IncidentMiniMap({ center, base, incidents }: {
  center: [number, number] | null;
  base: { lat: number; lon: number; label: string } | null;
  incidents: Incident[];
}) {
  const incPts = incidents.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon)).map((i) => [i.lat, i.lon] as [number, number]);
  const pts: [number, number][] = [...incPts, ...(base ? [[base.lat, base.lon] as [number, number]] : []), ...(center ? [center] : [])];
  const start: [number, number] = center ?? (base ? [base.lat, base.lon] : incPts[0]) ?? [20, 0];

  return (
    <div className="h-[200px] rounded-lg overflow-hidden border border-slate-700/60" style={{ isolation: "isolate", zIndex: 0 }}>
      <MapContainer center={start} zoom={5} scrollWheelZoom={false} style={{ height: "100%", width: "100%", background: "#070d18" }}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; OSM &copy; CARTO" maxZoom={12} />
        <FitBounds pts={pts} />
        {base && (
          <Marker position={[base.lat, base.lon]} icon={baseIcon}>
            <Popup><div className="text-[12px] font-mono"><b>{base.label}</b><div className="text-slate-500">pinned base</div></div></Popup>
          </Marker>
        )}
        {incidents.map((i, n) => (Number.isFinite(i.lat) && Number.isFinite(i.lon)) ? (
          <Marker key={n} position={[i.lat, i.lon]} icon={incIcon}>
            <Popup><div className="text-[12px] font-mono leading-tight max-w-[200px]"><b>{i.type}</b><div className="text-slate-500">{i.location}{i.fatalities > 0 ? ` · ${i.fatalities} killed` : ""}</div><div className="text-[10px] text-slate-600">{i.km == null ? "in-country" : `~${i.km}km`} · {i.src.toUpperCase()}</div></div></Popup>
          </Marker>
        ) : null)}
      </MapContainer>
    </div>
  );
}
