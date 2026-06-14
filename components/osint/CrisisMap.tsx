"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Polygon, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { cellToBoundary } from "h3-js";
import { AMC_HUBS } from "@/lib/amcHubs";
import { GATEWAYS } from "@/lib/airfields";
import { countryCentroid } from "@/lib/countryCentroids";
import { aorFromCoords, type Aor } from "@/lib/aor";
import type { AcledEvent } from "@/lib/acled";
import type { WeatherThreats, DisasterEvent, TravelAdvisory } from "@/lib/types";
import { fetchUiState, patchUiState, UI_KEYS } from "@/lib/clientUiState";

// Crisis / situation map + synced list — the spatial twin of the Global Reach
// Watch. What's happening (disasters, hub weather, tropical, NEO) over the AMC
// node network (en route hubs, Contingency Response stations, tracked
// locations), with each significant crisis tied to its nearest node by a
// great-circle distance + nominal C-17 flight time. Coarse SA, not planning.

const HUBS = AMC_HUBS.flatMap((g) => g.hubs);
const ENROUTE = HUBS.filter((h) => !h.crf);
const CRF = HUBS.filter((h) => h.crf);
const EARTH_NM = 3440.065;
const AORS: Aor[] = ["NORTHCOM", "SOUTHCOM", "EUCOM", "CENTCOM", "AFRICOM", "INDOPACOM"];
const TOGGLE_KEY = "crisisMap:layers";

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180, dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const toNm = (k: number) => k / 1.852;
function legText(node: { name: string }, distKm: number, cruiseKt: number): string {
  return `→ ${node.name.split(",")[0]} · ${Math.round(toNm(distKm)).toLocaleString()} nm · ~${(toNm(distKm) / cruiseKt).toFixed(1)} hr`;
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

// Great-circle interpolation between two points (for curved air-bridge legs).
function gcLine(lat1: number, lon1: number, lat2: number, lon2: number, n = 24): [number, number][] {
  const φ1 = (lat1 * Math.PI) / 180, λ1 = (lon1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180, λ2 = (lon2 * Math.PI) / 180;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (!Number.isFinite(d) || d === 0) return [[lat1, lon1], [lat2, lon2]];
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push([(Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, (Math.atan2(y, x) * 180) / Math.PI]);
  }
  return out;
}

// Illustrative airframe profiles — nominal one-way reach radius + cruise speed.
// Coarse SA, not performance data (no payload/wind/AR/clearance modeling).
const AIRFRAMES = {
  "C-17": { cruiseKt: 440, reachNm: 2400 },
  "C-5M": { cruiseKt: 450, reachNm: 5000 },
  "KC-46": { cruiseKt: 450, reachNm: 6000 },
} as const;
type AirframeKey = keyof typeof AIRFRAMES;
const AR_EXTENSION_NM = 3000; // nominal single-air-refueling extension (illustrative)

// Major AMC en route "air bridges" (ICAO sequences) — the mobility highways.
const AIR_BRIDGES: string[][] = [
  ["KDOV", "LPLA", "ETAR", "OTBH"], // East Coast → Azores → Ramstein → CENTCOM
  ["KCHS", "ETAR"],                  // Charleston → Ramstein
  ["KWRI", "ETAR"],                  // JB MDL → Ramstein
  ["KSUU", "PHIK", "PGUA", "RODN"], // Travis → Hickam → Guam → Kadena
  ["PHIK", "RJTY"],                  // Hickam → Yokota
];
const HUB_BY_ICAO = new Map(HUBS.map((h) => [h.icao, h]));

// Approximate tropical forecast cone: dead-reckon the storm forward along its
// current motion and widen by NHC's published ~5-yr average track-error radii.
// [forecast hour, error radius nm]. Capped at 48 h because DR straight-lines and
// a 5-day cone would mislead on recurving storms. A true cone needs the NHC GIS
// feed — this is labelled "approx".
const NHC_ERR_NM: [number, number][] = [[0, 12], [12, 26], [24, 40], [36, 55], [48, 69]];
function forecastCone(lat: number, lon: number, deg: number, kt: number) {
  const track: [number, number][] = [];
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (const [h, rad] of NHC_ERR_NM) {
    const c = h === 0 ? ([lat, lon] as [number, number]) : destPoint(lat, lon, deg, kt * h);
    track.push(c);
    left.push(destPoint(c[0], c[1], (deg - 90 + 360) % 360, rad));
    right.push(destPoint(c[0], c[1], (deg + 90) % 360, rad));
  }
  return { track, cone: [...left, ...right.reverse()] as [number, number][] };
}

const glyph = (html: string, size = 14) =>
  L.divIcon({ html: `<div style="line-height:1;text-shadow:0 0 3px #020617,0 0 3px #020617">${html}</div>`, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const enrouteIcon = glyph(`<span style="color:#34d399;font-size:13px">✈</span>`);
const crfIcon = glyph(`<span style="color:#5eead4;font-size:16px;font-weight:900">★</span>`, 16);
const airfieldIcon = glyph(`<span style="color:#38bdf8;font-size:12px">✈</span>`);
const homeIcon = glyph(`<span style="color:#34d399;font-size:18px;font-weight:900">⌂</span>`, 18);
const trackedIcon = glyph(`<span style="color:#94a3b8;font-size:11px">◇</span>`, 11);
const tropicalIcon = glyph(`<span style="font-size:15px">🌀</span>`, 16);
const neoDepartIcon = glyph(`<span style="color:#fca5a5;font-size:13px">🛫</span>`);
const neoLevel4Icon = glyph(`<span style="color:#fca5a5;font-size:12px">⛔</span>`, 13);
const acledIcon = glyph(`<span style="color:#f87171;font-size:12px;font-weight:900">◆</span>`, 12);

type LayerKey = "disasters" | "hazards" | "tropical" | "cone" | "radar" | "neo" | "conflict" | "acled" | "gps" | "informRisk" | "informSeverity" | "enroute" | "crf" | "airfields" | "tracked" | "lines" | "rings" | "ar" | "bridges" | "labels";

// Tooltip copy for each layer toggle.
const LAYER_DESC: Record<LayerKey, string> = {
  disasters: "Disaster & humanitarian events — GDACS (cyclone/quake/flood/drought/volcano), USGS quakes, and ReliefWeb complex-emergency / conflict / epidemic situations (plotted at country centroid). Dot colour = severity, size = HADR-airlift relevance. Click for details.",
  hazards: "Model weather hazards at your hubs/locations, next ~30 h (gusts, IFR/LIFR visibility, thunderstorms, snow/ice, temp extremes).",
  tropical: "Active tropical cyclones / typhoons / hurricanes (NOAA NHC).",
  cone: "~48 h forecast cone — approximate (storm motion × NHC average track error); not the official cone.",
  radar: "Precipitation / convection radar (RainViewer, global) — animated ~2 h loop + ~30 min nowcast. Tactical, short-range weather; most useful zoomed into a theater/airfield to judge weather impeding airlift / field access. Coverage is ground-radar-dependent (sparse over oceans/deserts) and there is NO multi-day forecast — blank ≠ clear, just no radar. Off by default.",
  neo: "U.S. State Dept Level-4 / embassy ordered-or-authorized departure advisories — potential NEO / evacuation airlift.",
  conflict: "Armed-conflict events. With a UCDP API token (UCDP_API_TOKEN): precise georeferenced events from the Uppsala Conflict Data Program — coordinates + fatalities, monthly candidate data (~1-2mo lag). Without a token, falls back to keyless ReliefWeb (UN OCHA) complex-emergency / conflict situations plotted at country level. Top events surface in the crisis list.",
  acled: "Structured conflict events (ACLED, last 14 days) — battles + remote violence (air/drone/missile strikes, shelling) with precise coordinates, sub-event type, named actors, and fatalities. Requires an ACLED account with recent-data access (Preferences → Sources & feeds → ACLED Strikes); empty if not set or the account tier embargoes recent data. Data © ACLED, acleddata.com.",
  gps: "GPS interference / EW — degraded navigation-accuracy hexes (GPSJam, ADS-B-derived, daily).",
  informRisk: "INFORM Risk (JRC) — structural country crisis-risk index 0-10, annual. Anticipatory 'where crises are likely' baseline; larger/redder = higher risk. Country-level.",
  informSeverity: "INFORM Severity (JRC) — current crisis severity by country, monthly. 'Where crises are happening now and how bad'; larger/redder = more severe. Country-level.",
  enroute: "AMC en route / mobility hubs.",
  crf: "Contingency Response stations (CRG/CRW/AMOW) — the 'open the airfield' first responders.",
  airfields: "Mobility gateway airfields — major C-17/C-130-capable international fields near crisis-prone regions (AFRICOM/CENTCOM/EUCOM/INDOPACOM/SOUTHCOM), the candidate fields to open/reopen for HADR or evacuation when no US hub is close.",
  tracked: "Your home + tracked locations (from Preferences).",
  lines: "Reach line from each significant crisis to its nearest CRF (great-circle distance + nominal flight time).",
  rings: "Reach rings — the selected airframe's nominal one-way radius around CRF nodes.",
  ar: "Air-refueling-extended reach ring around CRF nodes (illustrative single AR).",
  bridges: "Major AMC en route air-bridge corridors (great-circle).",
  labels: "Show/hide map labels — CRF + crisis callouts always; hub/tracked labels appear when zoomed in.",
};

// Layer toggles grouped for the collapsible "Layers" panel.
const LAYER_GROUPS: { label: string; keys: { k: LayerKey; label: string; dot?: string }[] }[] = [
  { label: "Threats", keys: [
    { k: "disasters", label: "Disasters", dot: "#f87171" }, { k: "hazards", label: "Hub wx", dot: "#fbbf24" },
    { k: "tropical", label: "Tropical", dot: "#38bdf8" }, { k: "cone", label: "Cone" },
    { k: "radar", label: "Radar", dot: "#22d3ee" },
    { k: "neo", label: "NEO", dot: "#fca5a5" }, { k: "conflict", label: "Conflict", dot: "#f43f5e" },
    { k: "acled", label: "ACLED", dot: "#f87171" }, { k: "gps", label: "GPS", dot: "#c084fc" },
  ] },
  { label: "Anticipatory", keys: [
    { k: "informSeverity", label: "INFORM Sev", dot: "#fb923c" }, { k: "informRisk", label: "INFORM Risk", dot: "#f59e0b" },
  ] },
  { label: "Nodes", keys: [
    { k: "enroute", label: "Hubs", dot: "#34d399" }, { k: "crf", label: "CRF", dot: "#5eead4" },
    { k: "airfields", label: "Gateways", dot: "#38bdf8" }, { k: "tracked", label: "Tracked", dot: "#94a3b8" },
  ] },
  { label: "Reach", keys: [
    { k: "lines", label: "Reach" }, { k: "rings", label: "Rings" }, { k: "ar", label: "AR" }, { k: "bridges", label: "Bridges" },
  ] },
  { label: "Display", keys: [{ k: "labels", label: "Labels" }] },
];

// One-click view presets — a curated layer set per use case.
const ALL_KEYS: LayerKey[] = LAYER_GROUPS.flatMap((g) => g.keys.map((x) => x.k));
const preset = (onKeys: LayerKey[]): Record<LayerKey, boolean> =>
  Object.fromEntries(ALL_KEYS.map((k) => [k, onKeys.includes(k)])) as Record<LayerKey, boolean>;
const PRESETS: { name: string; desc: string; on: Record<LayerKey, boolean> }[] = [
  { name: "Standard", desc: "Balanced default — disasters, hub weather, tropical+cone, NEO, conflict/kinetic, ACLED strikes, the node network, and reach lines.", on: preset(["disasters", "hazards", "tropical", "cone", "neo", "conflict", "acled", "enroute", "crf", "tracked", "lines", "labels"]) },
  { name: "HADR", desc: "Humanitarian focus — disasters, weather, tropical+cone, nodes, gateway airfields, reach lines + rings.", on: preset(["disasters", "hazards", "tropical", "cone", "enroute", "crf", "airfields", "tracked", "lines", "rings", "labels"]) },
  { name: "Contested", desc: "Conflict/EW focus — disasters, NEO, conflict density, ACLED strikes, GPS interference, nodes, reach lines.", on: preset(["disasters", "neo", "conflict", "acled", "gps", "enroute", "crf", "tracked", "lines", "labels"]) },
  { name: "Mobility", desc: "Network/reach focus — hubs, CRF, gateway airfields, tracked, reach rings + AR + air bridges.", on: preset(["enroute", "crf", "airfields", "tracked", "rings", "ar", "bridges", "labels"]) },
];
interface Tracked { label: string; lat: number; lon: number; home?: boolean }
interface Item { id: string; kind: "disaster" | "hazard" | "tropical" | "neo" | "kinetic" | "strike"; title: string; sub: string; tone: "red" | "amber" | "sky"; aor: Aor | null; lat: number; lon: number; score: number; href?: string }

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
  const [conflict, setConflict] = useState<{ lat: number; lon: number; name: string; count: number; title?: string; url?: string; src?: "ucdp" | "reliefweb" }[]>([]);
  const [gpsjam, setGpsjam] = useState<{ h3: string; level: number }[]>([]);
  const [acled, setAcled] = useState<AcledEvent[]>([]);
  type InformPt = { country: string; score: number; lat: number; lon: number };
  const [informRisk, setInformRisk] = useState<InformPt[]>([]);
  const [informSeverity, setInformSeverity] = useState<InformPt[]>([]);
  // Optional precipitation/convection radar (RainViewer) — animated loop.
  type RadarFrame = { time: number; path: string; kind: "past" | "nowcast" };
  const [radarHost, setRadarHost] = useState("");
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [radarIdx, setRadarIdx] = useState(0);
  const [radarNowIdx, setRadarNowIdx] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.6);
  // Sources that reported "upstream down" (ok:false) — rendered as an amber
  // badge so a blank layer reads as "source down", never as "all quiet".
  const [srcDown, setSrcDown] = useState<string[]>([]);
  const markSrc = (name: string, down: boolean) =>
    setSrcDown((prev) => (down ? (prev.includes(name) ? prev : [...prev, name]) : prev.filter((x) => x !== name)));
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
  const [layersOpen, setLayersOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [airframe, setAirframe] = useState<AirframeKey>("C-17");
  const AF = AIRFRAMES[airframe];
  const didFit = useRef(false);
  const [on, setOn] = useState<Record<LayerKey, boolean>>(() => {
    const base = { disasters: true, hazards: true, tropical: true, cone: true, radar: false, neo: true, conflict: true, acled: true, gps: false, informRisk: false, informSeverity: false, enroute: true, crf: true, airfields: false, tracked: true, lines: true, rings: false, ar: false, bridges: false, labels: true };
    if (typeof window !== "undefined") { try { return { ...base, ...(JSON.parse(localStorage.getItem(TOGGLE_KEY) || "{}")) }; } catch { /* ignore */ } }
    return base;
  });
  // Server-sync the layer toggles so the map config follows the user across
  // devices. `didHydrate` keeps the initial (local-only) render from POSTing
  // before we've read the server copy; localStorage still saves immediately.
  const didHydrate = useRef(false);
  useEffect(() => {
    fetchUiState()
      .then((st) => {
        const sv = st[UI_KEYS.crisisLayers];
        if (sv && typeof sv === "object" && !Array.isArray(sv)) {
          setOn((prev) => ({ ...prev, ...(sv as Partial<Record<LayerKey, boolean>>) }));
        }
      })
      .finally(() => { didHydrate.current = true; });
  }, []);
  useEffect(() => {
    try { localStorage.setItem(TOGGLE_KEY, JSON.stringify(on)); } catch { /* ignore */ }
    if (didHydrate.current) patchUiState({ [UI_KEYS.crisisLayers]: on });
  }, [on]);

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
    fetch("/api/osint/conflict", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { points?: { lat: number; lon: number; name: string; count: number; title?: string; url?: string; src?: "ucdp" | "reliefweb" }[]; ok?: boolean; source?: string | null } | null) => {
        if (Array.isArray(d?.points)) setConflict(d!.points);
        if (d) markSrc(d.source === "reliefweb" ? "ReliefWeb" : "UCDP", d.ok === false);
      })
      .catch(() => {});
    fetch("/api/osint/gpsjam", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hexes?: { h3: string; level: number }[]; ok?: boolean } | null) => {
        if (Array.isArray(d?.hexes)) setGpsjam(d!.hexes);
        if (d) markSrc("GPSJam", d.ok === false);
      })
      .catch(() => {});
    fetch("/api/osint/acled", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: AcledEvent[] } | null) => { if (Array.isArray(d?.events)) setAcled(d!.events); })
      .catch(() => {});
    fetch("/api/osint/inform?product=risk", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { points?: InformPt[] } | null) => { if (Array.isArray(d?.points)) setInformRisk(d!.points); })
      .catch(() => {});
    fetch("/api/osint/inform?product=severity", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { points?: InformPt[] } | null) => { if (Array.isArray(d?.points)) setInformSeverity(d!.points); })
      .catch(() => {});
    fetch("/api/osint/radar", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { host?: string; frames?: RadarFrame[]; nowIdx?: number } | null) => {
        if (d?.host && Array.isArray(d.frames) && d.frames.length) {
          setRadarHost(d.host); setRadarFrames(d.frames);
          setRadarNowIdx(d.nowIdx ?? 0); setRadarIdx(d.nowIdx ?? 0);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [refreshKey]);

  // Auto-refresh every 5 min.
  useEffect(() => { const id = setInterval(() => setRefreshKey((k) => k + 1), 5 * 60 * 1000); return () => clearInterval(id); }, []);

  // Radar time-loop — advance one frame every 600 ms when the layer is on and
  // playing (only the radar tiles re-render; the browser caches frames after the
  // first loop). Pauses when the layer is off so we don't churn tiles unseen.
  useEffect(() => {
    if (!on.radar || !radarPlaying || radarFrames.length < 2) return;
    const id = setInterval(() => setRadarIdx((i) => (i + 1) % radarFrames.length), 600);
    return () => clearInterval(id);
  }, [on.radar, radarPlaying, radarFrames.length]);

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

  // Top conflict events from the UCDP feed (AOR-filtered, highest-fatality
  // first). These get promoted out of the density layer into first-class
  // crisis-list / map entries so the most significant armed-conflict
  // activity is actually visible — keyed off the Conflict toggle so it stays
  // the single master switch for kinetic data.
  const kineticId = (c: { lat: number; lon: number }) => `k-${c.lat.toFixed(2)}-${c.lon.toFixed(2)}`;
  const kineticEvents = useMemo(
    () => [...conflict]
      .filter((c) => passAor(aorFromCoords(c.lat, c.lon)))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    [conflict, aorFilter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ACLED structured strikes (AOR-filtered). Rendered as precise markers and
  // the deadliest/most-recent promoted into the crisis list as kind "strike".
  const acledShown = useMemo(
    () => acled.filter((e) => passAor(aorFromCoords(e.lat, e.lon))),
    [acled, aorFilter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Ranked list (the map's table of contents).
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (on.acled) {
      const top = [...acledShown].sort((a, b) => (b.fatalities - a.fatalities) || b.date.localeCompare(a.date)).slice(0, 8);
      for (const e of top) {
        out.push({
          id: `a-${e.id}`,
          kind: "strike",
          title: e.notes || `${e.subType} — ${e.location || e.country}`,
          sub: `ACLED · ${e.subType}${e.fatalities > 0 ? ` · ${e.fatalities} killed` : ""} · ${[e.location, e.country].filter(Boolean).join(", ")}`,
          tone: "red",
          aor: aorFromCoords(e.lat, e.lon),
          lat: e.lat, lon: e.lon,
          score: 130 + Math.min(e.fatalities, 50), // rank at/above NEO ordered-departure
        });
      }
    }
    if (on.conflict) {
      for (const c of kineticEvents.slice(0, 8)) {
        out.push({
          id: kineticId(c),
          kind: "kinetic",
          title: c.title || c.name || "Kinetic activity",
          sub: c.title ? c.name : `${c.count} report${c.count === 1 ? "" : "s"} · last 2 days`,
          tone: "red",
          aor: aorFromCoords(c.lat, c.lon),
          lat: c.lat, lon: c.lon,
          score: 95 + Math.min(c.count, 40), // rank alongside red disasters / NEO
          href: c.url,
        });
      }
    }
    for (const d of disasters) {
      if (!isSignificant(d)) continue;
      const near = d.nearLocations.length > 0;
      out.push({ id: `d-${d.id}`, kind: "disaster", title: d.title, sub: near ? `Near ${d.nearLocations.join(", ")}` : (d.country || d.type), tone: d.severity === "red" || (d.hadrScore ?? 0) >= 60 ? "red" : "amber", aor: d.aor === "UNKNOWN" ? null : d.aor, lat: d.lat as number, lon: d.lon as number, score: (d.hadrScore ?? 0) + (near ? 55 : 0), href: d.link });
    }
    for (const z of hazShown) out.push({ id: `hz-${z.label}`, kind: "hazard", title: z.label, sub: z.flags.join(" · "), tone: z.severity === "severe" ? "red" : "amber", aor: aorFromCoords(z.lat, z.lon), lat: z.lat, lon: z.lon, score: z.severity === "severe" ? 75 : 45 });
    for (const { a, pos } of neoPins) { const evac = a.orderedDeparture || a.authorizedDeparture; if (!evac) continue; out.push({ id: `neo-${a.country}`, kind: "neo", title: a.country, sub: a.orderedDeparture ? "Ordered departure" : "Authorized departure", tone: a.orderedDeparture ? "red" : "amber", aor: a.aor === "UNKNOWN" ? null : (a.aor as Aor), lat: pos[0], lon: pos[1], score: a.orderedDeparture ? 120 : 85, href: a.link }); }
    for (const t of tropShown) out.push({ id: `t-${t.id}`, kind: "tropical", title: `${t.category} ${t.name}`, sub: `${t.intensityKt ?? "?"} kt · ${t.movement || "—"}`, tone: "sky", aor: aorFromCoords(t.lat as number, t.lon as number), lat: t.lat as number, lon: t.lon as number, score: 70 });
    return out.sort((a, b) => b.score - a.score);
  }, [disasters, hazShown, neoPins, tropShown, kineticEvents, acledShown, on.conflict, on.acled]);

  // Auto-fit once when crisis data first arrives.
  const crisisPoints = useMemo(() => items.map((i) => [i.lat, i.lon] as [number, number]), [items]);
  useEffect(() => { if (!didFit.current && crisisPoints.length > 0) { didFit.current = true; setFitKey((k) => k + 1); } }, [crisisPoints]);
  // Scroll the list to the selected row.
  useEffect(() => { if (selected) document.getElementById(`row-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [selected]);

  // Convergence — AORs where ≥2 distinct signal kinds stack up (the "hot AOR").
  const convergence = useMemo(() => {
    const m = new Map<Aor, Set<Item["kind"]>>();
    for (const it of items) { if (!it.aor) continue; const s = m.get(it.aor) ?? new Set<Item["kind"]>(); s.add(it.kind); m.set(it.aor, s); }
    return [...m.entries()].filter(([, k]) => k.size >= 2).map(([aor, k]) => ({ aor, kinds: [...k] }));
  }, [items]);

  // Precompute GPSJam hex boundaries once (cellToBoundary → [lat,lng] verts).
  const gpsPolys = useMemo(
    () => gpsjam.map((g) => { try { return { poly: cellToBoundary(g.h3) as [number, number][], level: g.level }; } catch { return null; } })
      .filter((x): x is { poly: [number, number][]; level: number } => x !== null),
    [gpsjam],
  );

  const runRead = () => {
    setAiOpen(true); setAiLoading(true);
    fetch("/api/crisis-read")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { text?: string; disabled?: boolean } | null) => setAiText(d?.disabled ? "AI features are off (no API key configured)." : d?.text || "Couldn't generate a read."))
      .catch(() => setAiText("Read failed — the data feed may be unavailable."))
      .finally(() => setAiLoading(false));
  };

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

  // Watch tallies + top conditions for the summary box below the map.
  const redCount = disasters.filter((d) => d.severity === "red").length;
  const nearCount = disasters.filter((d) => d.nearLocations.length > 0).length;
  const neoDep = neoPins.filter((x) => x.a.orderedDeparture || x.a.authorizedDeparture).length;
  const severeWx = hazShown.filter((z) => z.severity === "severe").length;
  const watchTop = items.slice(0, 5);

  const layerCount: Partial<Record<LayerKey, number>> = {
    disasters: disasters.length, hazards: hazShown.length, tropical: tropShown.length,
    neo: neoPins.length, conflict: conflict.length || undefined, acled: acledShown.length || undefined, gps: gpsjam.length || undefined,
    enroute: ENROUTE.length, crf: CRF.length, tracked: tracked.length,
  };
  const activeCount = Object.values(on).filter(Boolean).length;

  const chip = (k: LayerKey, label: string, n?: number, dot?: string) => (
    <button onClick={() => toggle(k)} title={LAYER_DESC[k]} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${on[k] ? "bg-violet-500/20 text-violet-200 border-violet-500/40" : "bg-slate-800/80 text-slate-500 border-slate-700/80 hover:text-slate-300"}`}>
      {dot && <span style={{ color: dot }}>●</span>}{label}{typeof n === "number" ? ` ${n}` : ""}
    </button>
  );
  const toneText = (t: Item["tone"]) => (t === "red" ? "text-red-400" : t === "sky" ? "text-sky-400" : "text-amber-400");
  const toneBorder = (t: Item["tone"]) => (t === "red" ? "border-l-red-500/70" : t === "sky" ? "border-l-sky-500/70" : "border-l-amber-500/70");

  return (
    <div className={fullscreen ? "fixed inset-0 z-[60] bg-slate-950 p-3 flex flex-col gap-2 overflow-auto" : "space-y-2"}>
      {/* Toolbar: view presets + controls (layer toggles collapse into Layers) */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">View</span>
        {PRESETS.map((pz) => (
          <button key={pz.name} onClick={() => setOn(pz.on)} title={pz.desc} className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border border-slate-700 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300 transition-all">{pz.name}</button>
        ))}
        <button onClick={() => setLayersOpen((v) => !v)} title="Show/hide individual layer toggles" className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${layersOpen ? "bg-violet-500/20 text-violet-200 border-violet-500/40" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>Layers {layersOpen ? "▴" : "▾"} <span className="text-slate-500">({activeCount})</span></button>
        <span className="mx-1 h-3 w-px bg-slate-700" />
        {/* Airframe selector — drives reach rings + flight-time callouts. */}
        <div className="flex items-center gap-0.5 rounded-md border border-slate-700 p-0.5" title="Airframe — drives reach-ring radius + flight-time callouts">
          {(Object.keys(AIRFRAMES) as AirframeKey[]).map((k) => (
            <button key={k} onClick={() => setAirframe(k)} className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${airframe === k ? "bg-emerald-500/20 text-emerald-300" : "text-slate-500 hover:text-slate-300"}`}>{k}</button>
          ))}
        </div>
        <select value={aorFilter} onChange={(e) => setAorFilter(e.target.value as Aor | "ALL")} title="Filter the map + list to one combatant-command AOR" className="bg-slate-800/80 border border-slate-700 rounded-md px-1.5 py-1 text-[10px] text-slate-300 outline-none">
          <option value="ALL">All AORs</option>
          {aorsPresent.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} placeholder="ICAO / base…" title="Fly to an AMC base by ICAO or name (Enter)" className="w-24 bg-slate-800/80 border border-slate-700 rounded-md px-1.5 py-1 text-[10px] text-slate-300 placeholder-slate-600 outline-none focus:border-slate-500" />
        <button onClick={() => setFitKey((k) => k + 1)} title="Fit the map to the active crises" className="px-2 py-1 rounded-md text-[10px] font-bold uppercase border border-slate-700 text-slate-400 hover:text-slate-200">Fit</button>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="px-2 py-1 rounded-md text-[10px] font-bold uppercase border border-slate-700 text-slate-400 hover:text-slate-200" title="Refresh all feeds now">↻</button>
        <button onClick={() => setFullscreen((v) => !v)} title="Toggle fullscreen" className="px-2 py-1 rounded-md text-[10px] font-bold uppercase border border-slate-700 text-slate-400 hover:text-slate-200">{fullscreen ? "Exit" : "Full"}</button>
        <button onClick={runRead} title="Claude anticipatory mobility-demand read of the current board" className="px-2 py-1 rounded-md text-[10px] font-bold uppercase border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20">Demand read</button>
        <span className="flex-1" />
        {srcDown.length > 0 && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/40"
            title={`${srcDown.join(", ")} unreachable — those layers are missing data, not reporting "all quiet"`}
          >
            ⚠ source down: {srcDown.join(", ")}
          </span>
        )}
        <span className="text-slate-700 font-mono">{loading ? "loading…" : fetchedAt ? `updated ${Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))}s ago` : "GDACS·USGS·NWS·NHC"}</span>
      </div>

      {/* Collapsible grouped layer toggles */}
      {layersOpen && (
        <div className="flex flex-wrap items-start gap-x-5 gap-y-2 bg-slate-900/40 border border-slate-800 rounded-md px-3 py-2">
          {LAYER_GROUPS.map((g) => (
            <div key={g.label} className="flex flex-col gap-1">
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{g.label}</span>
              <div className="flex flex-wrap gap-1">
                {g.keys.map((it) => chip(it.k, it.label, layerCount[it.k], it.dot))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Convergence strip — AORs where ≥2 signal kinds stack up. */}
      {convergence.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] bg-amber-500/5 border border-amber-500/20 rounded-md px-2.5 py-1.5">
          <span className="text-amber-400 font-bold uppercase tracking-wider">⚠ Convergence</span>
          {convergence.map((c) => (
            <button key={c.aor} onClick={() => setAorFilter(c.aor)} className="font-mono text-slate-300 hover:text-amber-300" title={`Filter to ${c.aor}`}>
              <span className="text-sky-400">{c.aor}</span> <span className="text-slate-500">({c.kinds.join(" + ")})</span>
            </button>
          ))}
        </div>
      )}

      {/* AI map read */}
      {aiOpen && (
        <div className="bg-emerald-500/[0.06] border border-emerald-500/30 rounded-md px-3 py-2 text-[12px] text-slate-200 leading-relaxed flex items-start gap-2">
          <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest flex-shrink-0 mt-0.5">Mobility<br/>demand</span>
          <p className="flex-1 min-w-0 whitespace-pre-line">{aiLoading ? "Reading the board…" : aiText}</p>
          <button onClick={() => setAiOpen(false)} className="text-slate-500 hover:text-slate-300 flex-shrink-0">×</button>
        </div>
      )}

      {/* Map + list */}
      <div className={`flex flex-col lg:flex-row gap-2 ${fullscreen ? "flex-1 min-h-0" : ""}`}>
        <div className={`relative bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden flex-1 ${fullscreen ? "min-h-0" : "h-[58vh] min-h-[360px] lg:h-[600px]"}`} style={{ isolation: "isolate", zIndex: 0 }}>
          <MapContainer center={[25, 10]} zoom={2} worldCopyJump style={{ height: "100%", width: "100%", background: "#020617" }} scrollWheelZoom>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap &copy; CARTO" maxZoom={19} />
            {on.radar && radarFrames[radarIdx] && (
              <TileLayer url={`${radarHost}${radarFrames[radarIdx].path}/256/{z}/{x}/{y}/2/1_1.png`} opacity={radarOpacity} zIndex={5} attribution="radar &copy; RainViewer" />
            )}
            <ZoomWatcher onZoom={setZoom} />
            <Flyer target={flyTo} />
            <Fitter points={crisisPoints} fitKey={fitKey} />

            {/* GPS interference / EW (GPSJam) hexes — drawn first, under everything. */}
            {on.gps && gpsPolys.map((g, i) => (
              <Polygon key={`gps-${i}`} positions={g.poly} pathOptions={{ color: g.level === 2 ? "#a855f7" : "#c084fc", fillColor: g.level === 2 ? "#a855f7" : "#c084fc", fillOpacity: 0.16, weight: 0.5, opacity: 0.4 }}>
                <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">GPS interference</div><div className="text-purple-600">{g.level === 2 ? "High" : "Moderate"} nav degradation</div><div className="text-slate-500">GPSJam (ADS-B-derived) — coarse SA</div></div></Popup>
              </Polygon>
            ))}

            {/* INFORM anticipatory country layers — drawn first, faint, under everything. */}
            {on.informRisk && informRisk.map((p, i) => {
              const f = Math.min(Math.max(p.score, 0) / 10, 1);
              return (
                <CircleMarker key={`ir-${i}`} center={[p.lat, p.lon]} radius={6 + f * 14} pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.08 + f * 0.16, weight: 0.5, opacity: 0.35 }}>
                  <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{p.country}</div><div className="text-amber-700">INFORM Risk {p.score.toFixed(1)}/10</div><div className="text-slate-500">Structural crisis-risk baseline (JRC)</div></div></Popup>
                </CircleMarker>
              );
            })}
            {on.informSeverity && informSeverity.map((p, i) => {
              const f = Math.min(Math.max(p.score, 0) / 5, 1);
              return (
                <CircleMarker key={`is-${i}`} center={[p.lat, p.lon]} radius={6 + f * 14} pathOptions={{ color: "#fb923c", fillColor: "#fb923c", fillOpacity: 0.10 + f * 0.20, weight: 0.6, opacity: 0.45 }}>
                  <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{p.country}</div><div className="text-orange-700">INFORM Severity {p.score.toFixed(1)}</div><div className="text-slate-500">Current crisis severity (JRC, monthly)</div></div></Popup>
                </CircleMarker>
              );
            })}
            {/* Conflict events (UCDP GED, most recent available) — drawn first, under the crisis markers. */}
            {on.conflict && conflict.map((c, i) => (
              <CircleMarker key={`cf-${i}`} center={[c.lat, c.lon]} radius={Math.min(4 + Math.log2(c.count + 1) * 1.6, 16)} pathOptions={{ color: "#f43f5e", fillColor: "#f43f5e", fillOpacity: 0.18, weight: 0.5, opacity: 0.45 }}>
                <Popup><div className="text-[12px] font-mono leading-tight max-w-[240px]"><div className="font-bold text-sm">{c.title || c.name || "Armed conflict"}</div>{c.title && c.name && <div className="text-slate-600">{c.name}</div>}{c.src === "reliefweb" ? (<><div className="text-rose-600">Active complex emergency / conflict</div>{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">ReliefWeb ↗</a> : <div className="text-slate-500">ReliefWeb (UN OCHA) — country-level</div>}</>) : (<><div className="text-rose-600">{c.count > 1 ? `${c.count} fatalities (best est.)` : "armed-conflict event"}</div><div className="text-slate-500">UCDP (Uppsala Conflict Data Program) — coarse SA</div></>)}</div></Popup>
              </CircleMarker>
            ))}

            {/* ACLED structured strikes — precise coordinates, sub-event type,
                actors, fatalities. Higher fidelity than the UCDP conflict read. */}
            {on.acled && acledShown.map((e) => (
              <Marker key={`acled-${e.id}`} position={[e.lat, e.lon]} icon={acledIcon} eventHandlers={{ click: () => pick(`a-${e.id}`, e.lat, e.lon) }}>
                <Popup><div className="text-[12px] font-mono leading-tight max-w-[260px]">
                  <div className="font-bold text-sm">{e.subType || e.type}</div>
                  <div className="text-slate-600">{[e.location, e.admin1, e.country].filter(Boolean).join(", ")}{e.date ? ` · ${e.date}` : ""}</div>
                  {e.actors && <div className="text-rose-700">{e.actors}</div>}
                  {e.fatalities > 0 && <div className="text-red-700 font-bold">{e.fatalities} reported killed</div>}
                  {e.notes && <div className="text-slate-700 mt-1">{e.notes}</div>}
                  <div className="text-slate-500 mt-1">{e.source ? `${e.source} · ` : ""}via ACLED — acleddata.com</div>
                </div></Popup>
              </Marker>
            ))}

            {/* En route air-bridge corridors (great-circle) */}
            {on.bridges && AIR_BRIDGES.map((seq, bi) => seq.slice(0, -1).map((icao, li) => {
              const a = HUB_BY_ICAO.get(icao), b2 = HUB_BY_ICAO.get(seq[li + 1]);
              return a && b2 ? <Polyline key={`br-${bi}-${li}`} positions={gcLine(a.lat, a.lon, b2.lat, b2.lon)} pathOptions={{ color: "#64748b", weight: 1, opacity: 0.45, dashArray: "1 5" }} /> : null;
            }))}

            {/* Reach rings — selected airframe's nominal one-way radius around CRF nodes. */}
            {on.rings && CRF.map((h) => <Polyline key={`ring-${h.icao}`} positions={geodesicRing(h.lat, h.lon, AF.reachNm)} pathOptions={{ color: "#5eead4", weight: 1, opacity: 0.3, dashArray: "3 6" }} />)}
            {/* AR-extended reach (illustrative single refueling). */}
            {on.ar && CRF.map((h) => <Polyline key={`ar-${h.icao}`} positions={geodesicRing(h.lat, h.lon, AF.reachNm + AR_EXTENSION_NM)} pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.22, dashArray: "1 7" }} />)}

            {on.lines && CRF.length > 0 && significant.map((d) => {
              const near = nearest(CRF, d.lat as number, d.lon as number);
              return near ? (
                <Polyline key={`line-${d.id}`} positions={[[d.lat as number, d.lon as number], [near.node.lat, near.node.lon]]} pathOptions={{ color: "#5eead4", weight: 1, opacity: 0.5, dashArray: "5 4" }}>
                  <Tooltip permanent direction="center" className="cm-label cm-route">{legText(near.node, near.distKm, AF.cruiseKt)}</Tooltip>
                </Polyline>
              ) : null;
            })}

            {(() => { const sd = selected?.startsWith("d-") ? disasters.find((d) => `d-${d.id}` === selected) : null; if (!sd) return null;
              const nh = nearest(ENROUTE, sd.lat as number, sd.lon as number), nc = nearest(CRF, sd.lat as number, sd.lon as number);
              return (<>
                {nh && <Polyline positions={[[sd.lat as number, sd.lon as number], [nh.node.lat, nh.node.lon]]} pathOptions={{ color: "#34d399", weight: 2, opacity: 0.9 }}><Tooltip permanent direction="center" className="cm-label cm-route">hub {legText(nh.node, nh.distKm, AF.cruiseKt)}</Tooltip></Polyline>}
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
            {on.airfields && GATEWAYS.map((g) => (
              <Marker key={`af-${g.icao}`} position={[g.lat, g.lon]} icon={airfieldIcon}>
                {showNodeLabels && <Tooltip permanent direction="right" offset={[6, 0]} className="cm-label">{g.icao}</Tooltip>}
                <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{g.name}</div><div><span className="text-slate-500">ICAO:</span> {g.icao}</div><div className="text-sky-700">Mobility gateway · C-17/C-130-capable</div><div className="text-slate-500">Candidate open/reopen field for HADR / evac</div></div></Popup>
              </Marker>
            ))}
            {on.tracked && tracked.map((t, i) => (
              <Marker key={`tr-${i}`} position={[t.lat, t.lon]} icon={t.home ? homeIcon : trackedIcon}>
                {/* Home is a singular anchor — label it whenever the labels layer
                    is on, not only when zoomed in like the other node labels. */}
                {(t.home ? on.labels : showNodeLabels) && (
                  <Tooltip permanent direction="right" offset={[8, 0]} className={t.home ? "cm-label cm-home" : "cm-label"}>{t.label}</Tooltip>
                )}
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
              const motion = t.movementDeg != null && t.movementKt != null && t.movementKt > 0;
              const fc = on.cone && motion ? forecastCone(lat, lon, t.movementDeg as number, t.movementKt as number) : null;
              const vec = !fc && motion ? destPoint(lat, lon, t.movementDeg as number, (t.movementKt as number) * 24) : null;
              return (
                <Fragment key={`t-${t.id}`}>
                  {fc && <Polygon positions={fc.cone} pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.4, fillColor: "#38bdf8", fillOpacity: 0.08 }} />}
                  {fc && <Polyline positions={fc.track} pathOptions={{ color: "#38bdf8", weight: 1.5, opacity: 0.85 }} />}
                  {vec && <Polyline positions={[[lat, lon], vec]} pathOptions={{ color: "#38bdf8", weight: 1.5, opacity: 0.7, dashArray: "4 4" }} />}
                  <Marker position={[lat, lon]} icon={tropicalIcon} eventHandlers={{ click: () => pick(`t-${t.id}`, lat, lon) }}>
                    {on.labels && <Tooltip permanent direction="top" offset={[0, -6]} className="cm-label cm-crisis">{t.category} {t.name}{t.intensityKt != null ? ` ${t.intensityKt}kt` : ""}</Tooltip>}
                    <Popup><div className="text-[12px] font-mono leading-tight"><div className="font-bold text-sm">{t.category} {t.name}</div>{t.intensityKt != null && <div><span className="text-slate-500">Wind:</span> {t.intensityKt} kt</div>}{t.movement && <div><span className="text-slate-500">Moving:</span> {t.movement}</div>}{fc && <div className="text-sky-600">— ~48 h forecast cone (approx; DR × NHC avg error)</div>}{vec && <div className="text-sky-600">— dashed = ~24 h motion</div>}{t.link && <a href={t.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">NHC ↗</a>}</div></Popup>
                  </Marker>
                </Fragment>
              );
            })}
          </MapContainer>

          {/* Radar time-loop bar — play/scrub + frame time + opacity, only when radar is on. */}
          {on.radar && radarFrames[radarIdx] && (() => {
            const f = radarFrames[radarIdx];
            const mins = Math.round((f.time * 1000 - Date.now()) / 60000);
            const zulu = new Date(f.time * 1000).toISOString().slice(11, 16) + "Z";
            const rel = mins === 0 ? "now" : mins > 0 ? `+${mins}m${f.kind === "nowcast" ? " nowcast" : ""}` : `${mins}m`;
            return (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-2 bg-slate-950/85 border border-slate-700 rounded-md px-2.5 py-1.5 text-[10px] text-slate-300 font-mono">
                <button onClick={() => setRadarPlaying((p) => !p)} title={radarPlaying ? "Pause" : "Play"} className="text-cyan-300 hover:text-cyan-200 w-4 text-center">{radarPlaying ? "⏸" : "▶"}</button>
                <input type="range" min={0} max={radarFrames.length - 1} value={radarIdx} onChange={(e) => { setRadarPlaying(false); setRadarIdx(Number(e.target.value)); }} className="w-28 accent-cyan-400" title="Scrub radar frames" />
                <span className="tabular-nums whitespace-nowrap">{zulu} <span className={mins > 0 ? "text-cyan-400" : "text-slate-500"}>{rel}</span></span>
                <span className="text-slate-700">·</span>
                <span className="text-slate-500">α</span>
                <input type="range" min={0} max={100} value={Math.round(radarOpacity * 100)} onChange={(e) => setRadarOpacity(Number(e.target.value) / 100)} className="w-12 accent-cyan-400" title="Radar opacity" />
              </div>
            );
          })()}

          {legend ? (
            <div className="absolute bottom-3 left-3 z-[400] bg-slate-950/85 border border-slate-700 rounded-md px-2.5 py-2 text-[9px] text-slate-400 font-mono leading-relaxed">
              <div className="flex items-center justify-between gap-3 mb-1"><span className="text-slate-500 uppercase tracking-wider font-bold">Legend</span><button onClick={() => setLegend(false)} className="text-slate-600 hover:text-slate-300">×</button></div>
              <div><span className="text-red-400">●</span>/<span className="text-orange-400">●</span> disaster (size=HADR) · <span className="text-amber-400">◯</span> hub wx</div>
              <div><span className="text-sky-400">🌀</span> tropical · <span className="text-sky-400">▱</span> ~48h cone (approx) / <span className="text-sky-400">– –</span> 24h motion · <span className="text-red-300">🛫</span>/<span className="text-red-300">⛔</span> NEO · <span style={{ color: "#f43f5e" }}>●</span> kinetic/conflict (✸ top events) · <span style={{ color: "#f87171" }}>◆</span> ACLED strike · <span style={{ color: "#c084fc" }}>⬡</span> GPS/EW</div>
              <div><span className="text-emerald-400">✈</span> hub · <span style={{ color: "#5eead4" }}>★</span> CRF · <span style={{ color: "#34d399", fontWeight: 900 }}>⌂</span> home · <span className="text-slate-400">◇</span> tracked</div>
              <div><span style={{ color: "#5eead4" }}>– –</span> reach (→ nearest CRF) · <span style={{ color: "#5eead4" }}>···</span> {airframe} ring {AF.reachNm.toLocaleString()} nm · <span className="text-sky-400">···</span> +AR · <span className="text-slate-400">··</span> air bridge</div>
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
              <li key={it.id} id={`row-${it.id}`} className={`flex items-stretch border-l-2 ${toneBorder(it.tone)} transition-colors ${selected === it.id ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}>
                <button onClick={() => pick(it.id, it.lat, it.lon, 5)} className="flex-1 min-w-0 text-left flex items-start gap-2 px-3 py-2">
                  <span className={`mt-0.5 ${toneText(it.tone)} flex-shrink-0`}>{it.kind === "tropical" ? "🌀" : it.kind === "neo" ? "🛫" : it.kind === "hazard" ? "◯" : it.kind === "strike" ? "◆" : it.kind === "kinetic" ? "✸" : "●"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-slate-200 truncate">{it.title}</span>
                    {it.sub && <span className="block text-[10px] text-slate-500 truncate">{it.sub}</span>}
                  </span>
                  {it.aor && <span className="text-[8px] font-mono uppercase tracking-wider text-sky-400/80 border border-sky-500/30 rounded px-1 py-0.5 flex-shrink-0 mt-0.5">{it.aor}</span>}
                </button>
                {it.href && (
                  <a href={it.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open source ↗" className="flex items-center px-2 text-slate-600 hover:text-emerald-400 transition-colors flex-shrink-0">↗</a>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* Watch box — the key conditions/alerts + data provenance, below the map. */}
      <section className="bg-slate-900/40 border border-slate-800 rounded-xl">
        <div className="px-3 py-2 border-b border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">⚠ Watch</span>
          <span className="text-[10px] font-mono text-slate-400">
            {redCount > 0 && <><span className="text-red-400">{redCount} red</span> · </>}
            {nearCount} near-base · {neoDep} NEO · <span className={severeWx > 0 ? "text-red-300" : ""}>{severeWx} severe wx</span> · {tropShown.length} tropical
          </span>
          {convergence.length > 0 && <span className="text-[10px] font-mono text-amber-300">· convergence: {convergence.map((c) => c.aor).join(", ")}</span>}
          <span className="flex-1" />
          <span className="text-[9px] text-slate-600 font-mono">{fetchedAt ? `as of ${new Date(fetchedAt).toISOString().slice(11, 16)}Z` : loading ? "loading…" : ""}</span>
        </div>
        <ul className="px-3 py-2 space-y-1">
          {watchTop.length === 0 && <li className="text-[11px] text-slate-600 font-mono">No watch conditions{loading ? " (loading…)" : ""} — quiet across tracked AORs and the hub network.</li>}
          {watchTop.map((it) => {
            const reach = it.kind !== "hazard" && CRF.length ? (() => { const n = nearest(CRF, it.lat, it.lon); return n ? legText(n.node, n.distKm, AF.cruiseKt) : ""; })() : "";
            return (
              <li key={it.id} className="text-[11px] flex flex-wrap items-baseline gap-x-2">
                <span className={toneText(it.tone)}>{it.kind === "tropical" ? "🌀" : it.kind === "neo" ? "🛫" : it.kind === "hazard" ? "◯" : it.kind === "strike" ? "◆" : it.kind === "kinetic" ? "✸" : "●"}</span>
                <button onClick={() => pick(it.id, it.lat, it.lon, 5)} className="text-slate-200 hover:text-emerald-400 font-medium">{it.title}</button>
                {it.sub && <span className="text-slate-500">{it.sub}</span>}
                {it.aor && <span className="text-[8px] font-mono uppercase tracking-wider text-sky-400/80 border border-sky-500/30 rounded px-1 py-0.5">{it.aor}</span>}
                {reach && <span className="text-[10px] text-emerald-500/80 font-mono">{reach}</span>}
                {it.href && <a href={it.href} target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-600 hover:text-emerald-400 font-mono">↗</a>}
              </li>
            );
          })}
        </ul>
        <div className="px-3 py-1.5 border-t border-slate-800 text-[9px] text-slate-600 leading-relaxed">
          <span className="font-bold uppercase tracking-wider text-slate-500">Sources</span>
          {" · "}Disasters: GDACS / USGS / ReliefWeb{" · "}Hub wx: Open-Meteo (model){" · "}Tropical: NOAA NHC{" · "}NEO: U.S. State Dept{" · "}Conflict events: Uppsala Conflict Data Program (UCDP), ReliefWeb (UN OCHA) fallback{" · "}Structured strikes: Armed Conflict Location &amp; Event Data Project (ACLED) — acleddata.com{" · "}GPS/EW: GPSJam{" · "}Crisis risk/severity: INFORM (JRC DRMKC){" · "}Radar: RainViewer{" · "}Airfields: AMC hubs + OurAirports{" · "}Basemap: CARTO / OpenStreetMap{" · "}Nodes, reach rings &amp; airframe figures: internal (illustrative). All open-source, coarse SA — not tasking.
        </div>
      </section>

      <p className={`text-[10px] text-slate-700 leading-relaxed ${fullscreen ? "hidden" : ""}`}>
        Disaster watch (GDACS/USGS), hub weather (model, next 30 h), tropical with a ~48 h forecast cone (approx; NHC), and
        NEO watch (State Dept) over the AMC node network (en route hubs ✈, Contingency Response ★, tracked locations). The
        convergence strip flags AORs where signals stack; the Demand read is a Claude anticipatory mobility-demand read — where airlift/HADR/NEO demand is emerging by AOR and the airfield-access implication. The Conflict layer
        surfaces armed-conflict events (UCDP GED, most recent available) — georeferenced battles and organized violence
        with coordinates and fatality counts — with the top events promoted into the crisis list.
        The ACLED layer (◆) adds higher-fidelity, human-coded strike events — precise coordinates, sub-event type, named
        actors, and fatalities (requires an ACLED account configured server-side; data &copy; Armed Conflict Location &amp; Event Data Project (ACLED), acleddata.com).
        GPS interference / EW (GPSJam) is an optional overlay. Click a
        list row or marker to fly there and route it to the nearest CRF/hub. Distances, flight times, airframe reach
        rings (incl. AR), air bridges, and CR associations are <span className="text-slate-500">illustrative coarse SA —
        nominal figures, no payload/wind/clearance modeling; not a planning product or tasking</span>.
      </p>
    </div>
  );
}
