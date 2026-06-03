// Humanitarian / natural-disaster aggregation from public, key-less, HTTPS
// sources. De-duplicated by domain: GDACS + USGS cover geophysical events
// (quakes, cyclones, floods, volcanoes, tsunami); ReliefWeb contributes
// epidemics / pandemics / complex emergencies. Every source fails to [] so a
// bad endpoint never breaks the threat board.

import type { DisasterEvent } from "./types";

const UA = "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── GDACS: global EQ / TC / FL / VO / DR / TS with Green/Orange/Red levels ──
const GDACS_TYPE: Record<string, DisasterEvent["type"]> = {
  EQ: "earthquake", TC: "cyclone", FL: "flood", VO: "volcano", DR: "drought", WF: "wildfire", TS: "tsunami",
};

async function fetchGdacs(): Promise<DisasterEvent[]> {
  try {
    const res = await fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP", {
      headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const feats: unknown[] = data?.features ?? [];
    return feats.flatMap((f): DisasterEvent[] => {
      if (!f || typeof f !== "object") return [];
      const p = (f as { properties?: Record<string, unknown> }).properties ?? {};
      const geom = (f as { geometry?: { coordinates?: unknown[] } }).geometry;
      const level = String(p.alertlevel ?? "").toLowerCase();
      if (level !== "orange" && level !== "red") return []; // skip Green noise
      const etype = String(p.eventtype ?? "").toUpperCase();
      const coords = Array.isArray(geom?.coordinates) ? geom!.coordinates : [];
      // GDACS `url` is sometimes a string, sometimes { report, details, ... }.
      const urlVal = p.url;
      const link = typeof urlVal === "string" ? urlVal
        : (urlVal && typeof urlVal === "object" && typeof (urlVal as { report?: unknown }).report === "string")
          ? (urlVal as { report: string }).report
          : "https://www.gdacs.org";
      const sevData = p.severitydata;
      const magFromSevData = sevData && typeof sevData === "object" ? num((sevData as { severity?: unknown }).severity) : null;
      return [{
        id: `gdacs-${p.eventtype}-${p.eventid ?? Math.random().toString(36).slice(2)}`,
        type: GDACS_TYPE[etype] ?? "other",
        title: String(p.name ?? p.htmldescription ?? etype),
        severity: level === "red" ? "red" : "orange",
        country: String(p.country ?? "").slice(0, 80),
        lat: num(coords[1]),
        lon: num(coords[0]),
        time: String(p.fromdate ?? p.datemodified ?? ""),
        magnitude: etype === "EQ" ? (num(p.severity) ?? magFromSevData) : null,
        tsunami: etype === "TS",
        summary: String(p.htmldescription ?? "").replace(/<[^>]+>/g, "").slice(0, 240),
        source: "GDACS",
        link,
        nearLocations: [],
      }];
    });
  } catch { return []; }
}

// ── USGS: fast, precise earthquakes (mag 4.5+, last day) ──
async function fetchUsgsQuakes(): Promise<DisasterEvent[]> {
  try {
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", {
      headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const feats: unknown[] = data?.features ?? [];
    return feats.flatMap((f): DisasterEvent[] => {
      if (!f || typeof f !== "object") return [];
      const p = (f as { properties?: Record<string, unknown> }).properties ?? {};
      const coords = (f as { geometry?: { coordinates?: unknown[] } }).geometry?.coordinates ?? [];
      const mag = num(p.mag);
      const alert = String(p.alert ?? "").toLowerCase(); // USGS PAGER: green/yellow/orange/red
      // Significant only: M5.5+ or an elevated PAGER alert.
      if ((mag ?? 0) < 5.5 && alert !== "orange" && alert !== "red") return [];
      const severity: DisasterEvent["severity"] =
        alert === "red" || (mag ?? 0) >= 7 ? "red"
        : alert === "orange" || (mag ?? 0) >= 6 ? "orange" : "green";
      return [{
        id: `usgs-${(f as { id?: string }).id ?? Math.random().toString(36).slice(2)}`,
        type: "earthquake",
        title: String(p.title ?? `M${mag ?? "?"} earthquake`),
        severity,
        country: String(p.place ?? "").replace(/^.*of\s+/i, "").slice(0, 80),
        lat: num(coords[1]),
        lon: num(coords[0]),
        time: p.time ? new Date(Number(p.time)).toISOString() : "",
        magnitude: mag,
        tsunami: Number(p.tsunami) === 1,
        summary: String(p.place ?? ""),
        source: "USGS",
        link: String(p.url ?? ""),
        nearLocations: [],
      }];
    });
  } catch { return []; }
}

// ── ReliefWeb: epidemics / pandemics / complex emergencies (humanitarian) ──
async function fetchReliefWeb(): Promise<DisasterEvent[]> {
  try {
    const url = "https://api.reliefweb.int/v1/disasters?appname=dead-web-dashboard&profile=list&preset=latest&limit=25"
      + "&fields[include][]=name&fields[include][]=status&fields[include][]=primary_type"
      + "&fields[include][]=country&fields[include][]=date&fields[include][]=url_alias";
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = data?.data ?? [];
    return rows.flatMap((row): DisasterEvent[] => {
      if (!row || typeof row !== "object") return [];
      const fields = (row as { fields?: Record<string, unknown> }).fields ?? {};
      const ptype = String((fields.primary_type as { name?: string })?.name ?? "");
      // Take only what GDACS/USGS don't already cover: health + complex crises.
      if (!/epidemic|pandemic|disease|complex|insecurity|conflict|technological/i.test(ptype)) return [];
      const status = String(fields.status ?? "").toLowerCase();
      const country = Array.isArray(fields.country)
        ? (fields.country as { name?: string }[]).map((c) => c.name).filter(Boolean).slice(0, 2).join(", ")
        : String((fields.country as { name?: string })?.name ?? "");
      return [{
        id: `rw-${(row as { id?: string | number }).id ?? Math.random().toString(36).slice(2)}`,
        type: /epidemic|pandemic|disease/i.test(ptype) ? "epidemic" : "other",
        title: String(fields.name ?? ptype),
        severity: status === "alert" ? "orange" : "green",
        country: country.slice(0, 80),
        lat: null, lon: null,
        time: String((fields.date as { created?: string })?.created ?? ""),
        magnitude: null,
        tsunami: false,
        summary: `${ptype}${status ? ` · ${status}` : ""}`,
        source: "ReliefWeb",
        link: String(fields.url_alias ?? "https://reliefweb.int/disasters"),
        nearLocations: [],
      }];
    });
  } catch { return []; }
}

const SEV_RANK: Record<DisasterEvent["severity"], number> = { red: 0, orange: 1, green: 2, unknown: 3 };

export async function getDisasters(): Promise<DisasterEvent[]> {
  const [gdacs, usgs, rw] = await Promise.all([fetchGdacs(), fetchUsgsQuakes(), fetchReliefWeb()]);
  const all = [...gdacs, ...usgs, ...rw];
  return all.sort((a, b) => {
    if (SEV_RANK[a.severity] !== SEV_RANK[b.severity]) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    return (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0);
  });
}

// Great-circle distance in km.
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
