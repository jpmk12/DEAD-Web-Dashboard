"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { DEFAULT_BASEMAP, DARKEN_CLASS } from "@/lib/basemaps";
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
  // Memoised on the inputs: a parent re-render (poll tick, busy flag) must not
  // rebuild the point list and re-fit the map over the user's pan.
  const incPts = useMemo(() => incidents.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon)).map((i) => [i.lat, i.lon] as [number, number]), [incidents]);
  const baseLat = base?.lat, baseLon = base?.lon, cLat = center?.[0], cLon = center?.[1];
  const pts = useMemo<[number, number][]>(() => [...incPts, ...(baseLat != null && baseLon != null ? [[baseLat, baseLon] as [number, number]] : []), ...(cLat != null && cLon != null ? [[cLat, cLon] as [number, number]] : [])], [incPts, baseLat, baseLon, cLat, cLon]);
  const start: [number, number] = center ?? (base ? [base.lat, base.lon] : incPts[0]) ?? [20, 0];

  return (
    <div className="h-[200px] rounded-lg overflow-hidden border border-slate-700/60" style={{ isolation: "isolate", zIndex: 0 }}>
      <MapContainer center={start} zoom={5} scrollWheelZoom={false} style={{ height: "100%", width: "100%", background: "#070d18" }}>
        {/* Same provider vocabulary as the Crisis map (lib/basemaps) — this map
            had the same CARTO nag tile. Deliberately NOT given the style picker
            or the fallback chain: a 200px inset doesn't warrant either, and one
            list means one fix. */}
        <TileLayer
          url={DEFAULT_BASEMAP.url}
          attribution={DEFAULT_BASEMAP.attribution}
          maxZoom={Math.min(12, DEFAULT_BASEMAP.maxZoom)}
          className={DEFAULT_BASEMAP.darken ? DARKEN_CLASS : undefined}
        />
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
