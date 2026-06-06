"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { AMC_HUBS } from "@/lib/amcHubs";
import { countryCentroid } from "@/lib/countryCentroids";
import { aorFromCoords, type Aor } from "@/lib/aor";
import type { WeatherThreats, DisasterEvent, TravelAdvisory } from "@/lib/types";

// Crisis / situation map + synced list — the spatial twin of the Global Reach
// Watch. What's happening (disasters, hub weather, tropical, NEO) over the AMC
// node network (en route hubs, Contingency Response stations, tracked
// locations), with each significant crisis tied to its nearest node by a
// great-circle distance + nominal C-17 flight time. Coarse SA, not planning.

const HUBS = AMC_HUBS.flatMap((g) => g.hubs);
const ENROUTE = HUBS.filter((h) => !h.crf);
const CRF = HUBS.filter((h) => h.crf);
const EARTH_NM = 3440.065;
const C17_CRUISE_KT = 440;
const AORS: Aor[] = ["NORTHCOM", "SOUTHCOM", "EUCOM", "CENTCOM", "AFRICOM", "INDOPACOM"];
const TOGGLE_KEY = "crisisMap:layers";

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180, dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const toNm = (k: number) => k / 1.852;
function legText(node: { name: string }, distKm: number): string {
  return `→ ${node.name.split(",")[0]} · ${Math.round(toNm(distKm)).toLocaleString()} nm · ~${(toNm(distKm) / C17_CRUISE_KT).toFixed(1)} hr`;
}
function nearest<T extends { lat: number; lon: number; name: string }>(list: T[], lat: number, lon: number) {
  let best: { node: T; distKm: number } | null = null;
  for (const n of list) { const d = km(lat, lon, n.lat, n.lon); if (!best || d < best.distKm) best = { node: n, distKm: d }; }
  return best;
}
function destPoint(lat: number, lon: number, brngDeg: number, distNm: number): [number, number] {
  const d = distNm / EARTH_NM, θ = (brngDeg * Math.PI) / 180, φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [(φ2 * 180) / Math.PI, (((λ2 * 180) / Math.PI + 540) % 360) - 180];
}
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
interface Item { id: string; kind: "disaster" | "hazard" | "tropical" | "neo"; title: string; sub: string; tone: "red" | "amber" | "sky"; aor: Aor | null; lat: number; lon: number; score: number; href?: string }

const EMPTY: WeatherThreats = {
  threats: [], tropical: [], disasters: [], hazards: [],
  summary: { extreme: 0, severe: 0, lifeThreatening: 0, total: 0, topEvent: null, disasters: 0, disastersRed: 0, hazardLocations: 0 },
};
const isSignificant = (d: DisasterEvent) => d.severity === "red" || d.nearLocations.length > 0 || (d.hadrScore ?? 0) >= 55;

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) });
  return null;
}
// Flies to a target when its key changes (selection / search / fit).
function Flyer({ target }: { target: { lat: number; lon: number; zoom: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo([target.lat, target.lon], target.zoom, { duration: 0.7 }); }, [target?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
// Fits bounds to the given points when fitKey changes (auto on first data + Fit button).
function Fitter({ points, fitKey }: { points: [number, number][]; fitKey: number }) {
  const map = useMap();
  useEffect(() => { if (points.length > 0) map.fitBounds(points, { padding: [40, 40], maxZoom: 5 }); }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function CrisisMap() {
  const [data, setData] = useState<WeatherThreats>(EMPTY);
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [advisories, setAdvisories] = useState<TravelAdvisory[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [zoom, setZoom] = useState(2);
  const [selected, setSelected] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; zoom: number; key: number } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [aorFilter, setAorFilter] = useState<Aor | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [legend, setLegend] = useState(true);
  const didFit = useRef(false);
  const [on, setOn] = useState<Record<LayerKey, boolean>>(() => {
    const base = { disasters: true, hazards: true, tropical: true, enroute: true, crf: true, tracked: true, neo: true, lines: true, rings: false, labels: true };
    if (typeof window !== "undefined") { try { return { ...base, ...(JSON.parse(localStorage.getItem(TOGGLE_KEY) || "{}")) }; } catch { /* ignore */ } }
    return base;
  });
  useEffect(() => { try { localStorage.setItem(TOGGLE_KEY, JSON.stringify(on)); } catch { /* ignore */ } }, [on]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch("/api/weather/threats", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WeatherThreats | null) => { setData(d && Array.isArray(d.disasters) ? d : EMPTY); setFetchedAt(Date.now()); })
      .catch(() => {})
      .finally(() => setLoading(false));
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
    fetch("/api/state-advisories", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { advisories?: TravelAdvisory[] } | null) => { if (Array.isArray(d?.advisories)) setAdvisories(d!.advisories); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [refreshKey]);

  // Auto-refresh every 5 min.
  useEffect(() => { const id = setInterval(() => setRefreshKey((k) => k + 1), 5 * 60 * 1000); return () => clearInterval(id); }, []);

  const allDisasters = useMemo(() => (Array.isArray(data.disasters) ? data.disasters : []).filter((d) => d.lat != null && d.lon != null), [data]);
  const hazards = Array.isArray(data.hazards) ? data.hazards : [];
  const tropical = (Array.isArray(data.tropical) ? data.tropical : []).filter((t) => t.lat != null && t.lon != null);
  const neoAll = useMemo(() => advisories.map((a) => ({ a, pos: countryCentroid(a.country) })).filter((x): x is { a: TravelAdvisory; pos: [number, number] } => x.pos !== null), [advisories]);

  // AOR filter (applies to items that carry an AOR).
  const passAor = (aor: Aor | null) => aorFilter === "ALL" || aor === null || aor === aorFilter;
  const disasters = allDisasters.filter((d) => passAor(d.aor === "UNKNOWN" ? null : d.aor));
  const hazShown = hazards.filter((z) => passAor(aorFromCoords(z.lat, z.lon)));
  const neoPins = neoAll.filter((x) => passAor((x.a.aor === "UNKNOWN" ? null : x.a.aor) as Aor | null));
  const tropShown = tropical.filter((t) => passAor(aorFromCoords(t.lat as number, t.lon as number)));

  const significant = useMemo(() => disasters.filter(isSignificant).sort((a, b) => (b.hadrScore ?? 0) - (a.hadrScore ?? 0)).slice(0, 8), [disasters]);

  // Ranked list (the map's table of contents).
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const d of disasters) {
      if (!isSignificant(d)) continue;
      const near = d.nearLocations.length > 0;
      out.push({ id: `d-${d.id}`, kind: "disaster", title: d.title, sub: near ? `Near ${d.nearLocations.join(", ")}` : (d.country || d.type), tone: d.severity === "red" || (d.hadrScore ?? 0) >= 60 ? "red" : "amber", aor: d.aor === "UNKNOWN" ? null : d.aor, lat: d.lat as number, lon: d.lon as number, score: (d.hadrScore ?? 0) + (near ? 55 : 0), href: d.link });
    }
    for (const z of hazShown) out.push({ id: `hz-${z.label}`, kind: "hazard", title: z.label, sub: z.flags.join(" · "), tone: z.severity === "severe" ? "red" : "amber", aor: aorFromCoords(z.lat, z.lon), lat: z.lat, lon: z.lon, score: z.severity === "severe" ? 75 : 45 });
    for (const { a, pos } of neoPins) { const evac = a.orderedDeparture || a.authorizedDeparture; if (!evac) continue; out.push({ id: `neo-${a.country}`, kind: "neo", title: a.country, sub: a.orderedDeparture ? "Ordered departure" : "Authorized departure", tone: a.orderedDeparture ? "red" : "amber", aor: a.aor === "UNKNOWN" ? null : (a.aor as Aor), lat: pos[0], lon: pos[1], score: a.orderedDeparture ? 120 : 85, href: a.link }); }
    for (const t of tropShown) out.push({ id: `t-${t.id}`, kind: "tropical", title: `${t.category} ${t.name}`, sub: `${t.intensityKt ?? "?"} kt · ${t.movement || "—"}`, tone: "sky", aor: aorFromCoords(t.lat as number, t.lon as number), lat: t.lat as number, lon: t.lon as number, score: 70 });
    return out.sort((a, b) => b.score - a.score);
  }, [disasters, hazShown, neoPins, tropShown]);

  // Auto-fit once when crisis data first arrives.
  const crisisPoints = useMemo(() => items.map((i) => [i.lat, i.lon] as [number, number]), [items]);
  useEffect(() => { if (!didFit.current && crisisPoints.length > 0) { didFit.current = true; setFitKey((k) => k + 1); } }, [crisisPoints]);
  // Scroll the list to the selected row.
  useEffect(() => { if (selected) document.getElementById(`row-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [selected]);

  const aorsPresent = useMemo(() => AORS.filter((a) => disasters.some((d) => d.aor === a) || neoPins.some((x) => x.a.aor === a)), [disasters, neoPins]);
  const toggle = (k: LayerKey) => setOn((p) => ({ ...p, [k]: !p[k] }));
  const showNodeLabels = on.labels && zoom >= 4;
  const pick = (id: string, lat: number, lon: number, z = 4) => { setSelected(id); setFlyTo({ lat, lon, zoom: z, key: Date.now() }); };

  const doSearch = () => {
    const q = search.trim().toUpperCase();
    if (!q) return;
    const h = HUBS.find((x) => x.icao === q || x.name.toUpperCase().includes(q));
    if (h) setFlyTo({ lat: h.lat, lon: h.lon, zoom: 6, key: Date.now() });
  };

  const chip = (k: LayerKey, label: string, n?: number, dot?: string) => (
    <button onClick={() => toggle(k)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${on[k] ? "bg-violet-500/20 text-violet-200 border-violet-500/40" : "bg-slate-800/80 text-slate-500 border-slate-700/80 hover:text-slate-300"}`}>
      {dot && <span style={{ color: dot }}>●</span>}{label}{typeof n === "number" ? ` ${n}` : ""}
    </button>
  );
  const toneText = (t: Item["tone"]) => (t === "red" ? "text-red-400" : t === "sky" ? "text-sky-400" : "text-amber-400");
  const toneBorder = (t: Item["tone"]) => (t === "red" ? "border-l-red-500/70" : t === "sky" ? "border-l-sky-500/70" : "border-l-amber-500/70");

  return (
    <div className={fullscreen ? "fixed inset-0 z-[60] bg-slate-950 p-3 flex flex-col gap-2 overflow-auto" : "space-y-2"}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {chip("disasters", "Disasters", disasters.length, "#f87171")}
        {chip("hazards", "Hub wx", hazShown.length, "#fbbf24")}
        {chip("tropical", "Tropical", tropShown.length, "#38bdf8")}
        {chip("neo", "NEO", neoPins.length, "#fca5a5")}
        {chip("enroute", "Hubs", ENROUTE.length, "#34d399")}
        {chip("crf", "CRF", CRF.length, "#5eead4")}
        {chip("tracked", "Tracked", tracked.length, "#94a3b8")}
        {chip("lines", "Reach")}
        {chip("rings", "Rings")}
        {chip("labels", "Labels")}
        <span className="mx-1 h-3 w-px bg-slate-700" />
        <select value={aorFilter} onChange={(e) => setAorFilter(e.target.value as Aor | "ALL")} className="bg-slate-800/80 border border-slate-700 rounded-md px-1.5 py-1 text-[10px] text-slate-300 outline-none">
          <option value="ALL">All AORs</option>
          {aorsPresent.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} placeholder="ICAO / base…" className="w-24 bg-slate-800/80 border border-slate-700 rounded-md px-1.5 py-1 text-[10px] text-slate-300 placeholder-slate-600 outline-none focus:border-slate-500" />
        <button onClick={() => setFitKey((k) => k + 1)} className="px-2 py-1 rounded-md text-[10px] font-bold uppercase border border-slate-700 text-slate-400 hover:text-slate-200">Fit</button>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="px-2 py-1 rounded-md text-[10px] font-bold uppercase border border-slate-700 text-slate-400 hover:text-slate-200" title="Refresh">↻</button>
        <button onClick={() => setFullscreen((v) => !v)} className="px-2 py-1 rounded-md text-[10px] font-bold uppercase border border-slate-700 text-slate-400 hover:text-slate-200">{fullscreen ? "Exit" : "Full"}</button>
        <span className="flex-1" />
        <span className="text-slate-700 font-mono">{loading ? "loading…" : fetchedAt ? `updated ${Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))}s ago` : "GDACS·USGS·NWS·NHC"}</span>
      </div>

      {/* Map + list */}
      <div className={`flex flex-col lg:flex-row gap-2 ${fullscreen ? "flex-1 min-h-0" : ""}`}>
        <div className={`relative bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden flex-1 ${fullscreen ? "min-h-0" : "h-[58vh] min-h-[360px] lg:h-[600px]"}`} style={{ isolation: "isolate", zIndex: 0 }}>
          <MapContainer center={[25, 10]} zoom={2} worldCopyJump style={{ height: "100%", width: "100%", background: "#020617" }} scrollWheelZoom>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap &copy; CARTO" maxZoom={19} />
            <ZoomWatcher onZoom={setZoom} />
            <Flyer target={flyTo} />
            <Fitter points={crisisPoints} fitKey={fitKey} />

            {on.rings && CRF.map((h) => <Polyline key={`ring-${h.icao}`} positions={geodesicRing(h.lat, h.lon, 2000)} pathOptions={{ color: "#5eead4", weight: 1, opacity: 0.3, dashArray: "3 6" }} />)}

            {on.lines && CRF.length > 0 && significant.map((d) => {
              const near = nearest(CRF, d.lat as number, d.lon as number);
              return near ? (
                <Polyline key={`line-${d.id}`} positions={[[d.lat as number, d.lon as number], [near.node.lat, near.node.lon]]} pathOptions={{ color: "#5eead4", weight: 1, opacity: 0.5, dashArray: "5 4" }}>
                  <Tooltip permanent direction="center" className="cm-label cm-route">{legText(near.node, near.distKm)}</Tooltip>
                </Polyline>
              ) : null;
            })}

            {(() => { const sd = selected?.startsWith("d-") ? disasters.find((d) => `d-${d.id}` === selected) : null; if (!sd) return null;
              const nh = nearest(ENROUTE, sd.lat as number, sd.lon as number), nc = nearest(CRF, sd.lat as number, sd.lon as number);
              return (<>
                {nh && <Polyline positions={[[sd.lat as number, sd.lon as number], [nh.node.lat, nh.node.lon]]} pathOptions={{ color: "#34d399", weight: 2, opacity: 0.9 }}><Tooltip permanent direction="center" className="cm-label cm-route">hub {legText(nh.node, nh.distKm)}</Tooltip></Polyline>}
                {nc && <Polyline positions={[[sd.lat as number, sd.lon as number], [nc.node.lat, nc.node.lon]]} pathOptions={{ color: "#5eead4", weight: 2, opacity: 0.9, dashArray: "5 4" }} />}
              </>);
            })()}

            {on.enroute && ENROUTE.map((h) => (
              <Marker key={`er-${h.icao}`} position={[h.lat, h.lon]} icon={enrouteIcon}>
                {showNodeLabels && <Tooltip permanent direction="right" offset={[6, 0]} className="cm-label">{h.icao}</Tooltip>}
                <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{h.name}</div><div><span className="text-slate-500">ICAO:</span> {h.icao}</div><div className="text-slate-500">En route / mobility hub</div></div></Popup>
              </Marker>
            ))}
            {on.crf && CRF.map((h) => (
              <Marker key={`crf-${h.icao}`} position={[h.lat, h.lon]} icon={crfIcon}>
                {on.labels && <Tooltip permanent direction="right" offset={[7, 0]} className="cm-label cm-crf">{h.crf} · {h.icao}</Tooltip>}
                <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{h.name}</div><div className="text-emerald-700">Contingency Response: {h.crf}</div><div><span className="text-slate-500">ICAO:</span> {h.icao}</div></div></Popup>
              </Marker>
            ))}
            {on.tracked && tracked.map((t, i) => (
              <Marker key={`tr-${i}`} position={[t.lat, t.lon]} icon={t.home ? homeIcon : trackedIcon}>
                {showNodeLabels && <Tooltip permanent direction="right" offset={[6, 0]} className="cm-label">{t.label}</Tooltip>}
                <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{t.label}</div><div className="text-slate-500">{t.home ? "Home" : "Tracked location"}</div></div></Popup>
              </Marker>
            ))}
            {on.neo && neoPins.map(({ a, pos }) => { const evac = a.orderedDeparture || a.authorizedDeparture; return (
              <Marker key={`neo-${a.country}`} position={pos} icon={evac ? neoDepartIcon : neoLevel4Icon} eventHandlers={{ click: () => pick(`neo-${a.country}`, pos[0], pos[1]) }}>
                {on.labels && evac && <Tooltip permanent direction="top" offset={[0, -6]} className="cm-label cm-crisis">{a.country}{a.aor !== "UNKNOWN" ? ` · ${a.aor}` : ""} · {a.orderedDeparture ? "ORDERED DEP" : "AUTH DEP"}</Tooltip>}
                <Popup><div className="text-[12px] font-mono leading-tight max-w-[220px]"><div className="font-bold text-sm">{a.country}</div><div className={evac ? "text-red-700" : "text-amber-700"}>{a.orderedDeparture ? "Ordered departure — evacuation" : a.authorizedDeparture ? "Authorized departure" : "Level 4 — Do Not Travel"}{a.level ? ` · Level ${a.level}` : ""}</div>{a.aor !== "UNKNOWN" && <div className="text-slate-500">{a.aor}</div>}{a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">State advisory ↗</a>}</div></Popup>
              </Marker>
            ); })}
            {on.hazards && hazShown.map((z) => (
              <CircleMarker key={`hz-${z.label}`} center={[z.lat, z.lon]} radius={selected === `hz-${z.label}` ? 13 : 10} pathOptions={{ color: selected === `hz-${z.label}` ? "#fff" : z.severity === "severe" ? "#ef4444" : "#fbbf24", weight: 2, fill: false, opacity: 0.9 }} eventHandlers={{ click: () => pick(`hz-${z.label}`, z.lat, z.lon) }}>
                <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{z.label}</div><div className={z.severity === "severe" ? "text-red-600" : "text-amber-600"}>{z.severity === "severe" ? "Severe" : "Elevated"} · next 30 h</div><div className="text-slate-600">{z.flags.join(" · ")}</div></div></Popup>
              </CircleMarker>
            ))}
            {on.disasters && disasters.map((d) => {
              const hadr = d.hadrScore ?? 0, color = d.severity === "red" ? "#ef4444" : d.severity === "orange" ? "#fb923c" : "#64748b";
              const sel = selected === `d-${d.id}`;
              return (
                <CircleMarker key={`d-${d.id}`} center={[d.lat as number, d.lon as number]} radius={(hadr >= 55 ? 9 : d.severity === "red" ? 7 : 5) + (sel ? 3 : 0)} pathOptions={{ color: sel ? "#fff" : color, fillColor: color, fillOpacity: 0.55, weight: sel ? 3 : hadr >= 55 ? 2.5 : 1 }} eventHandlers={{ click: () => pick(`d-${d.id}`, d.lat as number, d.lon as number) }}>
                  {on.labels && significant.includes(d) && <Tooltip permanent direction="top" offset={[0, -6]} className="cm-label cm-crisis">{d.magnitude != null ? `M${d.magnitude.toFixed(1)} ` : ""}{d.type}{d.aor !== "UNKNOWN" ? ` · ${d.aor}` : ""}</Tooltip>}
                  <Popup><div className="text-[12px] font-mono leading-tight max-w-[240px]"><div className="font-bold text-sm mb-0.5">{d.title}</div><div className="text-slate-600">{[d.country, d.type].filter(Boolean).join(" · ")}</div><div className="mt-1 flex flex-wrap gap-1"><span className="px-1 rounded" style={{ background: color, color: "#fff" }}>{d.severity}</span>{d.aor !== "UNKNOWN" && <span className="px-1 rounded bg-sky-100 text-sky-800">{d.aor}</span>}{hadr >= 55 && <span className="px-1 rounded bg-orange-100 text-orange-800">HADR {hadr}</span>}{d.nearLocations.length > 0 && <span className="px-1 rounded bg-red-100 text-red-800">near {d.nearLocations.join(", ")}</span>}</div>{d.link && <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline mt-1 inline-block">open ↗</a>}</div></Popup>
                </CircleMarker>
              );
            })}
            {on.tropical && tropShown.map((t) => {
              const lat = t.lat as number, lon = t.lon as number;
              const vec = t.movementDeg != null && t.movementKt ? destPoint(lat, lon, t.movementDeg, t.movementKt * 24) : null;
              return (
                <Fragment key={`t-${t.id}`}>
                  {vec && <Polyline positions={[[lat, lon], vec]} pathOptions={{ color: "#38bdf8", weight: 1.5, opacity: 0.7, dashArray: "4 4" }} />}
                  <Marker position={[lat, lon]} icon={tropicalIcon} eventHandlers={{ click: () => pick(`t-${t.id}`, lat, lon) }}>
                    {on.labels && <Tooltip permanent direction="top" offset={[0, -6]} className="cm-label cm-crisis">{t.category} {t.name}{t.intensityKt != null ? ` ${t.intensityKt}kt` : ""}</Tooltip>}
                    <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{t.category} {t.name}</div>{t.intensityKt != null && <div><span className="text-slate-500">Wind:</span> {t.intensityKt} kt</div>}{t.movement && <div><span className="text-slate-500">Moving:</span> {t.movement}</div>}{vec && <div className="text-sky-600">— dashed = ~24 h motion</div>}{t.link && <a href={t.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">NHC ↗</a>}</div></Popup>
                  </Marker>
                </Fragment>
              );
            })}
          </MapContainer>

          {legend ? (
            <div className="absolute bottom-3 left-3 z-[400] bg-slate-950/85 border border-slate-700 rounded-md px-2.5 py-2 text-[9px] text-slate-400 font-mono leading-relaxed">
              <div className="flex items-center justify-between gap-3 mb-1"><span className="text-slate-500 uppercase tracking-wider font-bold">Legend</span><button onClick={() => setLegend(false)} className="text-slate-600 hover:text-slate-300">×</button></div>
              <div><span className="text-red-400">●</span>/<span className="text-orange-400">●</span> disaster (size=HADR) · <span className="text-amber-400">◯</span> hub wx</div>
              <div><span className="text-sky-400">🌀</span> tropical <span className="text-sky-400">– –</span> 24h motion · <span className="text-red-300">🛫</span>/<span className="text-red-300">⛔</span> NEO</div>
              <div><span className="text-emerald-400">✈</span> hub · <span style={{ color: "#5eead4" }}>★</span> CRF · <span className="text-slate-300">⌂</span> home · <span className="text-slate-400">◇</span> tracked</div>
              <div><span style={{ color: "#5eead4" }}>– –</span> reach (→ nearest CRF) · <span style={{ color: "#5eead4" }}>···</span> ~2,000 nm ring</div>
            </div>
          ) : (
            <button onClick={() => setLegend(true)} className="absolute bottom-3 left-3 z-[400] bg-slate-950/85 border border-slate-700 rounded-md px-2 py-1 text-[9px] text-slate-400 font-mono hover:text-slate-200">legend</button>
          )}
        </div>

        {/* Synced list */}
        <aside className={`lg:w-80 flex-shrink-0 bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden flex flex-col ${fullscreen ? "min-h-0" : "max-h-[58vh] lg:max-h-[600px]"}`}>
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Crisis list</span>
            <span className="text-[9px] text-slate-600 font-mono">{items.length} · {aorFilter === "ALL" ? "all AORs" : aorFilter}</span>
          </div>
          <ul className="overflow-y-auto flex-1 divide-y divide-slate-800/60">
            {items.length === 0 && <li className="px-3 py-4 text-[11px] text-slate-600 font-mono">No events match{loading ? " (loading…)" : ""}.</li>}
            {items.map((it) => (
              <li key={it.id} id={`row-${it.id}`}>
                <button onClick={() => pick(it.id, it.lat, it.lon, 5)} className={`w-full text-left flex items-start gap-2 px-3 py-2 border-l-2 ${toneBorder(it.tone)} transition-colors ${selected === it.id ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}>
                  <span className={`mt-0.5 ${toneText(it.tone)} flex-shrink-0`}>{it.kind === "tropical" ? "🌀" : it.kind === "neo" ? "🛫" : it.kind === "hazard" ? "◯" : "●"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-slate-200 truncate">{it.title}</span>
                    {it.sub && <span className="block text-[10px] text-slate-500 truncate">{it.sub}</span>}
                  </span>
                  {it.aor && <span className="text-[8px] font-mono uppercase tracking-wider text-sky-400/80 border border-sky-500/30 rounded px-1 py-0.5 flex-shrink-0 mt-0.5">{it.aor}</span>}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <p className={`text-[10px] text-slate-700 leading-relaxed ${fullscreen ? "hidden" : ""}`}>
        Disaster watch (GDACS/USGS), hub weather (model, next 30 h), tropical with a ~24 h motion vector (NHC), and NEO
        watch (State Dept) over the AMC node network (en route hubs ✈, Contingency Response ★, tracked locations). Click a
        list row or marker to fly there and route it to the nearest CRF/hub. Distances, flight times, rings, and CR
        associations are <span className="text-slate-500">illustrative coarse SA — not a planning product or tasking</span>.
      </p>
    </div>
  );
}
