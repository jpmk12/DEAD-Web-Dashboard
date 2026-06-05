"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, Tooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { AMC_HUBS } from "@/lib/amcHubs";
import { countryCentroid } from "@/lib/countryCentroids";
import type { WeatherThreats, DisasterEvent, TravelAdvisory } from "@/lib/types";

// Crisis / situation map — the spatial twin of the Global Reach Watch. Shows
// what's happening (disasters, hub weather, tropical), the AMC node network
// (en route hubs, Contingency Response stations, tracked locations) with labels,
// and ties each significant crisis to its nearest node with a great-circle
// distance + nominal C-17 flight-time callout. Coarse SA, not planning.

const HUBS = AMC_HUBS.flatMap((g) => g.hubs);
const ENROUTE = HUBS.filter((h) => !h.crf);
const CRF = HUBS.filter((h) => h.crf);

const EARTH_NM = 3440.065;
const C17_CRUISE_KT = 440; // nominal cruise for an illustrative leg time

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const toNm = (k: number) => k / 1.852;
function legText(node: { name: string }, distKm: number): string {
  const nm = Math.round(toNm(distKm));
  const hr = toNm(distKm) / C17_CRUISE_KT;
  return `→ ${node.name.split(",")[0]} · ${nm.toLocaleString()} nm · ~${hr.toFixed(1)} hr`;
}
function nearest<T extends { lat: number; lon: number; name: string }>(list: T[], lat: number, lon: number): { node: T; distKm: number } | null {
  let best: { node: T; distKm: number } | null = null;
  for (const n of list) {
    const d = km(lat, lon, n.lat, n.lon);
    if (!best || d < best.distKm) best = { node: n, distKm: d };
  }
  return best;
}

// Destination point `distNm` along bearing `brngDeg` from (lat,lon) (great-circle).
function destPoint(lat: number, lon: number, brngDeg: number, distNm: number): [number, number] {
  const d = distNm / EARTH_NM, θ = (brngDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [(φ2 * 180) / Math.PI, (((λ2 * 180) / Math.PI + 540) % 360) - 180];
}

// Great-circle ring sampled to vertices (a constant-radius geodesic renders as
// an ellipse on web-Mercator; sampling keeps it honest).
function geodesicRing(lat: number, lon: number, radiusNm: number, n = 72): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) out.push(destPoint(lat, lon, (i / n) * 360, radiusNm));
  return out;
}

const glyph = (html: string, size = 14) =>
  L.divIcon({ html: `<div style="line-height:1;text-shadow:0 0 3px #020617,0 0 3px #020617">${html}</div>`, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const enrouteIcon = glyph(`<span style="color:#34d399;font-size:13px">✈</span>`);
const crfIcon = glyph(`<span style="color:#5eead4;font-size:16px;font-weight:900">★</span>`, 16);
const homeIcon = glyph(`<span style="color:#cbd5e1;font-size:13px">⌂</span>`);
const trackedIcon = glyph(`<span style="color:#94a3b8;font-size:11px">◇</span>`, 11);
const tropicalIcon = glyph(`<span style="font-size:15px">🌀</span>`, 16);
const neoDepartIcon = glyph(`<span style="color:#fca5a5;font-size:13px">🛫</span>`);
const neoLevel4Icon = glyph(`<span style="color:#fca5a5;font-size:12px">⛔</span>`, 13);

type LayerKey = "disasters" | "hazards" | "tropical" | "enroute" | "crf" | "tracked" | "neo" | "lines" | "rings" | "labels";

interface Tracked { label: string; lat: number; lon: number; home?: boolean }

const EMPTY: WeatherThreats = {
  threats: [], tropical: [], disasters: [], hazards: [],
  summary: { extreme: 0, severe: 0, lifeThreatening: 0, total: 0, topEvent: null, disasters: 0, disastersRed: 0, hazardLocations: 0 },
};

const isSignificant = (d: DisasterEvent) => d.severity === "red" || d.nearLocations.length > 0 || (d.hadrScore ?? 0) >= 55;

// Tracks the live zoom so node labels can appear only when zoomed in enough.
function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) });
  return null;
}

export default function CrisisMap() {
  const [data, setData] = useState<WeatherThreats>(EMPTY);
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [advisories, setAdvisories] = useState<TravelAdvisory[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(2);
  const [selected, setSelected] = useState<string | null>(null);
  const [on, setOn] = useState<Record<LayerKey, boolean>>({
    disasters: true, hazards: true, tropical: true, enroute: true, crf: true, tracked: true, neo: true, lines: true, rings: false, labels: true,
  });
  const [legend, setLegend] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/weather/threats", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WeatherThreats | null) => setData(d && Array.isArray(d.disasters) ? d : EMPTY))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Tracked locations (home + user-tracked) for the node layer.
    fetch("/api/user-prefs", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { localLat?: number; localLon?: number; localCity?: string; trackedLocations?: { label: string; lat: number; lon: number }[] } | null) => {
        if (!p) return;
        const t: Tracked[] = [];
        if (typeof p.localLat === "number" && typeof p.localLon === "number") t.push({ label: p.localCity || "Home", lat: p.localLat, lon: p.localLon, home: true });
        for (const l of p.trackedLocations ?? []) if (typeof l.lat === "number" && typeof l.lon === "number") t.push({ label: l.label, lat: l.lat, lon: l.lon });
        setTracked(t);
      })
      .catch(() => {});
    // NEO watch — State Dept Level-4 / embassy-departure advisories.
    fetch("/api/state-advisories", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { advisories?: TravelAdvisory[] } | null) => { if (Array.isArray(d?.advisories)) setAdvisories(d!.advisories); })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const disasters = useMemo(() => (Array.isArray(data.disasters) ? data.disasters : []).filter((d) => d.lat != null && d.lon != null), [data]);
  const hazards = Array.isArray(data.hazards) ? data.hazards : [];
  const tropical = (Array.isArray(data.tropical) ? data.tropical : []).filter((t) => t.lat != null && t.lon != null);

  // Significant crises (capped) get a standing callout + a nearest-CRF reach line.
  const significant = useMemo(
    () => disasters.filter(isSignificant).sort((a, b) => (b.hadrScore ?? 0) - (a.hadrScore ?? 0)).slice(0, 6),
    [disasters],
  );

  // NEO advisories that resolve to a country centroid (others can't be pinned).
  const neoPins = useMemo(
    () => advisories
      .map((a) => ({ a, pos: countryCentroid(a.country) }))
      .filter((x): x is { a: TravelAdvisory; pos: [number, number] } => x.pos !== null),
    [advisories],
  );

  const toggle = (k: LayerKey) => setOn((p) => ({ ...p, [k]: !p[k] }));
  const showNodeLabels = on.labels && zoom >= 4; // en route / tracked labels only when zoomed in

  const chip = (k: LayerKey, label: string, n?: number, dot?: string) => (
    <button onClick={() => toggle(k)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${on[k] ? "bg-violet-500/20 text-violet-200 border-violet-500/40" : "bg-slate-800/80 text-slate-500 border-slate-700/80 hover:text-slate-300"}`}>
      {dot && <span style={{ color: dot }}>●</span>}{label}{typeof n === "number" ? ` ${n}` : ""}
    </button>
  );

  const selectedDisaster = selected ? disasters.find((d) => d.id === selected) ?? null : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {chip("disasters", "Disasters", disasters.length, "#f87171")}
        {chip("hazards", "Hub wx", hazards.length, "#fbbf24")}
        {chip("tropical", "Tropical", tropical.length, "#38bdf8")}
        {chip("enroute", "En route", ENROUTE.length, "#34d399")}
        {chip("crf", "CRF", CRF.length, "#5eead4")}
        {chip("tracked", "Tracked", tracked.length, "#94a3b8")}
        {chip("neo", "NEO", neoPins.length, "#fca5a5")}
        {chip("lines", "Reach lines")}
        {chip("rings", "Reach rings")}
        {chip("labels", "Labels")}
        <span className="flex-1" />
        <span className="text-slate-700 font-mono">{loading ? "loading…" : "GDACS · USGS · NWS · NHC"}</span>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden relative h-[58vh] min-h-[360px] lg:h-[600px]" style={{ isolation: "isolate", zIndex: 0 }}>
        <MapContainer center={[25, 10]} zoom={2} worldCopyJump style={{ height: "100%", width: "100%", background: "#020617" }} scrollWheelZoom>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap &copy; CARTO" maxZoom={19} />
          <ZoomWatcher onZoom={setZoom} />

          {/* Reach rings — illustrative ~2,000 nm around the Contingency Response nodes. */}
          {on.rings && CRF.map((h) => (
            <Polyline key={`ring-${h.icao}`} positions={geodesicRing(h.lat, h.lon, 2000)} pathOptions={{ color: "#5eead4", weight: 1, opacity: 0.3, dashArray: "3 6" }} />
          ))}

          {/* Auto reach lines: each significant crisis → nearest CRF, with distance/time. */}
          {on.lines && CRF.length > 0 && significant.map((d) => {
            const near = nearest(CRF, d.lat as number, d.lon as number);
            if (!near) return null;
            return (
              <Polyline key={`line-${d.id}`} positions={[[d.lat as number, d.lon as number], [near.node.lat, near.node.lon]]} pathOptions={{ color: "#5eead4", weight: 1, opacity: 0.5, dashArray: "5 4" }}>
                <Tooltip permanent direction="center" className="cm-label cm-route">{legText(near.node, near.distKm)}</Tooltip>
              </Polyline>
            );
          })}

          {/* Click-to-route: selected crisis → nearest hub (emerald) + nearest CRF (cyan). */}
          {selectedDisaster && (() => {
            const nh = nearest(ENROUTE, selectedDisaster.lat as number, selectedDisaster.lon as number);
            const nc = nearest(CRF, selectedDisaster.lat as number, selectedDisaster.lon as number);
            return (
              <>
                {nh && (
                  <Polyline positions={[[selectedDisaster.lat as number, selectedDisaster.lon as number], [nh.node.lat, nh.node.lon]]} pathOptions={{ color: "#34d399", weight: 2, opacity: 0.9 }}>
                    <Tooltip permanent direction="center" className="cm-label cm-route">hub {legText(nh.node, nh.distKm)}</Tooltip>
                  </Polyline>
                )}
                {nc && (
                  <Polyline positions={[[selectedDisaster.lat as number, selectedDisaster.lon as number], [nc.node.lat, nc.node.lon]]} pathOptions={{ color: "#5eead4", weight: 2, opacity: 0.9, dashArray: "5 4" }} />
                )}
              </>
            );
          })()}

          {/* En route hubs */}
          {on.enroute && ENROUTE.map((h) => (
            <Marker key={`er-${h.icao}`} position={[h.lat, h.lon]} icon={enrouteIcon}>
              {showNodeLabels && <Tooltip permanent direction="right" offset={[6, 0]} className="cm-label">{h.icao}</Tooltip>}
              <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{h.name}</div><div><span className="text-slate-500">ICAO:</span> {h.icao}</div><div className="text-slate-500">En route / mobility hub</div></div></Popup>
            </Marker>
          ))}

          {/* Contingency Response stations — always labeled (few, high value). */}
          {on.crf && CRF.map((h) => (
            <Marker key={`crf-${h.icao}`} position={[h.lat, h.lon]} icon={crfIcon}>
              {on.labels && <Tooltip permanent direction="right" offset={[7, 0]} className="cm-label cm-crf">{h.crf} · {h.icao}</Tooltip>}
              <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{h.name}</div><div className="text-emerald-700">Contingency Response: {h.crf}</div><div><span className="text-slate-500">ICAO:</span> {h.icao}</div></div></Popup>
            </Marker>
          ))}

          {/* Tracked locations (home + user-tracked) */}
          {on.tracked && tracked.map((t, i) => (
            <Marker key={`tr-${i}`} position={[t.lat, t.lon]} icon={t.home ? homeIcon : trackedIcon}>
              {showNodeLabels && <Tooltip permanent direction="right" offset={[6, 0]} className="cm-label">{t.label}</Tooltip>}
              <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{t.label}</div><div className="text-slate-500">{t.home ? "Home" : "Tracked location"}</div></div></Popup>
            </Marker>
          ))}

          {/* NEO watch — State Dept Level-4 / embassy-departure advisories at
              country centroids. Departures (🛫) are the evacuation triggers and
              carry a callout; standing Level-4 (⛔) show on click. */}
          {on.neo && neoPins.map(({ a, pos }) => {
            const evac = a.orderedDeparture || a.authorizedDeparture;
            return (
              <Marker key={`neo-${a.country}`} position={pos} icon={evac ? neoDepartIcon : neoLevel4Icon}>
                {on.labels && evac && (
                  <Tooltip permanent direction="top" offset={[0, -6]} className="cm-label cm-crisis">
                    {a.country}{a.aor !== "UNKNOWN" ? ` · ${a.aor}` : ""} · {a.orderedDeparture ? "ORDERED DEP" : "AUTH DEP"}
                  </Tooltip>
                )}
                <Popup>
                  <div className="text-[12px] font-mono leading-tight max-w-[220px]">
                    <div className="font-bold text-sm">{a.country}</div>
                    <div className={evac ? "text-red-700" : "text-amber-700"}>
                      {a.orderedDeparture ? "Ordered departure — evacuation" : a.authorizedDeparture ? "Authorized departure" : "Level 4 — Do Not Travel"}
                      {a.level ? ` · Level ${a.level}` : ""}
                    </div>
                    {a.aor !== "UNKNOWN" && <div className="text-slate-500">{a.aor}</div>}
                    {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">State advisory ↗</a>}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Hub weather hazards — halo at the affected point */}
          {on.hazards && hazards.map((z) => (
            <CircleMarker key={`hz-${z.label}`} center={[z.lat, z.lon]} radius={10} pathOptions={{ color: z.severity === "severe" ? "#ef4444" : "#fbbf24", weight: 2, fill: false, opacity: 0.85 }}>
              <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{z.label}</div><div className={z.severity === "severe" ? "text-red-600" : "text-amber-600"}>{z.severity === "severe" ? "Severe" : "Elevated"} · next 30 h</div><div className="text-slate-600">{z.flags.join(" · ")}</div></div></Popup>
            </CircleMarker>
          ))}

          {/* Disasters — color by severity, size by HADR; significant ones labeled */}
          {on.disasters && disasters.map((d) => {
            const hadr = d.hadrScore ?? 0;
            const color = d.severity === "red" ? "#ef4444" : d.severity === "orange" ? "#fb923c" : "#64748b";
            const sig = isSignificant(d) && significant.includes(d);
            return (
              <CircleMarker
                key={`d-${d.id}`}
                center={[d.lat as number, d.lon as number]}
                radius={hadr >= 55 ? 9 : d.severity === "red" ? 7 : 5}
                pathOptions={{ color: selected === d.id ? "#fff" : color, fillColor: color, fillOpacity: 0.55, weight: selected === d.id ? 3 : hadr >= 55 ? 2.5 : 1 }}
                eventHandlers={{ click: () => setSelected((s) => (s === d.id ? null : d.id)) }}
              >
                {on.labels && sig && (
                  <Tooltip permanent direction="top" offset={[0, -6]} className="cm-label cm-crisis">
                    {d.magnitude != null ? `M${d.magnitude.toFixed(1)} ` : ""}{d.type}{d.aor !== "UNKNOWN" ? ` · ${d.aor}` : ""}
                  </Tooltip>
                )}
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
                    <div className="mt-1 text-slate-500">Click the dot to route to the nearest hub + CRF.</div>
                    {d.link && <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline mt-1 inline-block">open ↗</a>}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          {/* Tropical systems + 24-hour motion vector (heading × forward speed).
              A full NHC forecast cone needs the GIS feed — this is the
              dead-reckoning track from the current advisory's motion. */}
          {on.tropical && tropical.map((t) => {
            const lat = t.lat as number, lon = t.lon as number;
            const vec = t.movementDeg != null && t.movementKt ? destPoint(lat, lon, t.movementDeg, t.movementKt * 24) : null;
            return (
              <Fragment key={`t-${t.id}`}>
                {vec && <Polyline positions={[[lat, lon], vec]} pathOptions={{ color: "#38bdf8", weight: 1.5, opacity: 0.7, dashArray: "4 4" }} />}
                <Marker position={[lat, lon]} icon={tropicalIcon}>
                  {on.labels && <Tooltip permanent direction="top" offset={[0, -6]} className="cm-label cm-crisis">{t.category} {t.name}{t.intensityKt != null ? ` ${t.intensityKt}kt` : ""}</Tooltip>}
                  <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{t.category} {t.name}</div>{t.intensityKt != null && <div><span className="text-slate-500">Wind:</span> {t.intensityKt} kt</div>}{t.movement && <div><span className="text-slate-500">Moving:</span> {t.movement}</div>}{vec && <div className="text-sky-600">— dashed = ~24 h motion</div>}{t.link && <a href={t.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">NHC ↗</a>}</div></Popup>
                </Marker>
              </Fragment>
            );
          })}
        </MapContainer>

        {/* Legend overlay */}
        {legend ? (
          <div className="absolute bottom-3 left-3 z-[400] bg-slate-950/85 border border-slate-700 rounded-md px-2.5 py-2 text-[9px] text-slate-400 font-mono leading-relaxed">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-slate-500 uppercase tracking-wider font-bold">Legend</span>
              <button onClick={() => setLegend(false)} className="text-slate-600 hover:text-slate-300" title="Hide legend">×</button>
            </div>
            <div><span className="text-red-400">●</span>/<span className="text-orange-400">●</span> disaster (size = HADR)</div>
            <div><span className="text-amber-400">◯</span> hub wx hazard · <span className="text-sky-400">🌀</span> tropical <span className="text-sky-400">– –</span> ~24h motion</div>
            <div><span className="text-red-300">🛫</span> ordered/auth departure · <span className="text-red-300">⛔</span> Level-4 (NEO)</div>
            <div><span className="text-emerald-400">✈</span> en route hub · <span style={{ color: "#5eead4" }}>★</span> CRF station</div>
            <div><span className="text-slate-300">⌂</span> home · <span className="text-slate-400">◇</span> tracked</div>
            <div><span style={{ color: "#5eead4" }}>– –</span> reach line (→ nearest CRF) · <span style={{ color: "#5eead4" }}>···</span> ~2,000 nm ring</div>
          </div>
        ) : (
          <button onClick={() => setLegend(true)} className="absolute bottom-3 left-3 z-[400] bg-slate-950/85 border border-slate-700 rounded-md px-2 py-1 text-[9px] text-slate-400 font-mono hover:text-slate-200">legend</button>
        )}
      </div>

      <p className="text-[10px] text-slate-700 leading-relaxed">
        Disaster watch (GDACS/USGS), hub weather (model, next 30 h), tropical systems with a ~24 h motion vector (NHC;
        a full forecast cone needs the NHC GIS feed), and NEO watch (State Dept Level-4 / embassy-departure advisories,
        pinned at country centroids) over the AMC node network: en route hubs ✈, Contingency Response stations ★, and
        your tracked locations. Reach lines tie each significant crisis to its nearest CRF with a great-circle distance +
        nominal C-17 flight time; click a disaster to route it to the nearest hub and CRF. Distances, flight times,
        reach rings, motion vectors, country pins, and CR associations are
        <span className="text-slate-500"> illustrative coarse SA — not a planning product or tasking</span>.
      </p>
    </div>
  );
}
