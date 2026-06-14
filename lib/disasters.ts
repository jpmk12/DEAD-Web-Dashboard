// Humanitarian / natural-disaster aggregation from public, key-less, HTTPS
// sources. De-duplicated by domain: GDACS + USGS cover geophysical events
// (quakes, cyclones, floods, volcanoes, tsunami); ReliefWeb contributes
// epidemics / pandemics / complex emergencies. Every source fails to [] so a
// bad endpoint never breaks the threat board.

import Parser from "rss-parser";
import type { DisasterEvent } from "./types";
import { classifyAor } from "./aor";
import { fetchWithTimeout } from "./fetchTimeout";

const UA = "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)";

// Source functions build everything except `aor`, which getDisasters() assigns
// centrally so the classification rule lives in one place.
type RawDisaster = Omit<DisasterEvent, "aor" | "hadrScore">;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── GDACS: global EQ / TC / FL / VO / DR / TS with Green/Orange/Red levels ──
const GDACS_TYPE: Record<string, DisasterEvent["type"]> = {
  EQ: "earthquake", TC: "cyclone", FL: "flood", VO: "volcano", DR: "drought", WF: "wildfire", TS: "tsunami",
};

async function fetchGdacs(): Promise<RawDisaster[]> {
  try {
    const res = await fetchWithTimeout("https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP", {
      headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store",
    }, 10_000);
    if (!res.ok) return [];
    const data = await res.json();
    const feats: unknown[] = data?.features ?? [];
    return feats.flatMap((f): RawDisaster[] => {
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
        alertScore: num(p.alertscore),
      }];
    });
  } catch { return []; }
}

// ── USGS: fast, precise earthquakes (mag 4.5+, last day) ──
async function fetchUsgsQuakes(): Promise<RawDisaster[]> {
  try {
    const res = await fetchWithTimeout("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", {
      headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store",
    }, 10_000);
    if (!res.ok) return [];
    const data = await res.json();
    const feats: unknown[] = data?.features ?? [];
    return feats.flatMap((f): RawDisaster[] => {
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
async function fetchReliefWeb(): Promise<RawDisaster[]> {
  try {
    const url = "https://api.reliefweb.int/v1/disasters?appname=dead-web-dashboard&profile=list&preset=latest&limit=40"
      + "&fields[include][]=name&fields[include][]=status&fields[include][]=primary_type"
      + "&fields[include][]=country&fields[include][]=primary_country.location&fields[include][]=date&fields[include][]=url_alias";
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" }, 10_000);
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = data?.data ?? [];
    return rows.flatMap((row): RawDisaster[] => {
      if (!row || typeof row !== "object") return [];
      const fields = (row as { fields?: Record<string, unknown> }).fields ?? {};
      const ptype = String((fields.primary_type as { name?: string })?.name ?? "");
      // Take only what GDACS/USGS don't already cover: health + complex crises.
      if (!/epidemic|pandemic|disease|complex|insecurity|conflict|technological/i.test(ptype)) return [];
      const status = String(fields.status ?? "").toLowerCase();
      const country = Array.isArray(fields.country)
        ? (fields.country as { name?: string }[]).map((c) => c.name).filter(Boolean).slice(0, 2).join(", ")
        : String((fields.country as { name?: string })?.name ?? "");
      // primary_country.location gives a centroid lat/lon — without it ReliefWeb
      // events have no coords and get dropped from the map (it filters null
      // coords), which hid every complex-emergency / conflict situation.
      const pc = fields.primary_country as { location?: { lat?: unknown; lon?: unknown } } | undefined;
      const plat = Number(pc?.location?.lat), plon = Number(pc?.location?.lon);
      return [{
        id: `rw-${(row as { id?: string | number }).id ?? Math.random().toString(36).slice(2)}`,
        type: /epidemic|pandemic|disease/i.test(ptype) ? "epidemic" : "other",
        title: String(fields.name ?? ptype),
        // Complex emergencies / conflict / insecurity are standing HADR-airlift
        // drivers — mark them orange so they rank above routine green entries.
        severity: (status === "alert" || /complex|insecurit|conflict|violence/i.test(ptype)) ? "orange" : "green",
        country: country.slice(0, 80),
        lat: Number.isFinite(plat) ? plat : null,
        lon: Number.isFinite(plon) ? plon : null,
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

// ── Tsunami Warning Centers: NOAA CAP/Atom feeds (tsunami.gov) ──
// NTWC (Palmer, AK) covers the US/Canada coasts incl. Caribbean & Atlantic;
// PTWC (Honolulu) covers the Pacific & Indian Ocean basins. The feeds carry a
// CAP entry per bulletin; we surface Warnings/Watches/Advisories and drop the
// routine "no tsunami / information statement" entries to cut noise.
const capParser: Parser<unknown, { capEvent?: string; capSeverity?: string; capArea?: string; capEffective?: string; geoPoint?: string }> =
  new Parser({
    customFields: {
      item: [
        ["cap:event", "capEvent"], ["cap:severity", "capSeverity"],
        ["cap:areaDesc", "capArea"], ["cap:effective", "capEffective"],
        ["georss:point", "geoPoint"],
      ],
    },
  });

const TSUNAMI_CENTERS: { code: "NTWC" | "PTWC"; url: string }[] = [
  { code: "NTWC", url: "https://www.tsunami.gov/events/xml/PAAQAtom.xml" },
  { code: "PTWC", url: "https://www.tsunami.gov/events/xml/PHEBAtom.xml" },
];

async function fetchTsunamiCenters(): Promise<RawDisaster[]> {
  const results = await Promise.all(
    TSUNAMI_CENTERS.map(async ({ code, url }): Promise<RawDisaster[]> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        let text: string;
        try {
          const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": UA, Accept: "application/xml, application/atom+xml, */*" } });
          if (!res.ok) return [];
          text = await res.text();
        } finally { clearTimeout(timer); }
        const feed = await capParser.parseString(text);
        return (feed.items ?? []).flatMap((item): RawDisaster[] => {
          const headline = `${item.capEvent ?? item.title ?? ""}`;
          // Keep only actionable bulletins; skip routine info / "no tsunami".
          if (!/warning|watch|advisory/i.test(headline) || /no tsunami|information statement|cancel/i.test(headline)) return [];
          const severity: DisasterEvent["severity"] =
            /warning/i.test(headline) ? "red" : /watch/i.test(headline) ? "orange" : "green";
          const [plat, plon] = (item.geoPoint ?? "").split(/\s+/).map(Number);
          return [{
            id: `tsunami-${code}-${item.guid || item.link || item.capEffective || Math.random().toString(36).slice(2)}`,
            type: "tsunami",
            title: String(item.title ?? headline),
            severity,
            country: String(item.capArea ?? "").slice(0, 80),
            lat: Number.isFinite(plat) ? plat : null,
            lon: Number.isFinite(plon) ? plon : null,
            time: String(item.capEffective ?? item.isoDate ?? item.pubDate ?? ""),
            magnitude: null,
            tsunami: true,
            summary: String(item.contentSnippet ?? item.content ?? headline).replace(/<[^>]+>/g, "").slice(0, 240),
            source: code,
            link: String(item.link ?? "https://www.tsunami.gov"),
            nearLocations: [],
          }];
        });
      } catch { return []; }
    }),
  );
  return results.flat();
}

// ── Volcanic ash: USGS Volcano Hazards Program aviation color codes ──
// Covers the U.S. VAAC mission domains (Anchorage = Alaska/Aleutians,
// Washington = Cascades/Marianas). Aviation color ORANGE/RED = ash hazard to
// flight. Non-U.S. volcanoes continue to arrive via GDACS (VO).

// USGS link for an elevated-volcano alert.
// The HANS feed carries no ready-made link, and the modern per-volcano
// usgs.gov slug (e.g. /volcanoes/great-sitkin) now 404s. The VHP
// "volcano-updates" page is the stable, maintained landing page that lists
// current activity/alert levels for all elevated U.S. volcanoes, so point
// every VHP alert there.
const VHP_UPDATES_URL = "https://www.usgs.gov/programs/VHP/volcano-updates";

async function fetchVolcanicAsh(): Promise<RawDisaster[]> {
  try {
    const res = await fetchWithTimeout("https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes", {
      headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data) ? data : (data?.data ?? []);
    return rows.flatMap((row): RawDisaster[] => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      const color = String(r.color_code ?? r.cc ?? "").toUpperCase();
      if (color !== "ORANGE" && color !== "RED") return []; // ash hazard only
      const name = String(r.volcano_name ?? r.volcano ?? "Volcano");
      const level = String(r.alert_level ?? r.alevel ?? "");
      return [{
        id: `vhp-${r.vnum ?? r.volcano_name ?? Math.random().toString(36).slice(2)}`,
        type: "volcano",
        title: `${name}${level ? ` — ${level}` : ""}`,
        severity: color === "RED" ? "red" : "orange",
        country: "United States",
        lat: num(r.latitude ?? r.lat),
        lon: num(r.longitude ?? r.lon),
        time: String(r.synopsis_date ?? r.sent ?? ""),
        magnitude: null,
        tsunami: false,
        summary: `Aviation color ${color}${level ? ` · ${level}` : ""}`,
        source: "USGS-VHP",
        link: VHP_UPDATES_URL,
        nearLocations: [],
      }];
    });
  } catch { return []; }
}

const SEV_RANK: Record<DisasterEvent["severity"], number> = { red: 0, orange: 1, green: 2, unknown: 3 };

// Two events are the "same" if they're the same type within ~25 km — collapses
// e.g. a GDACS volcano and the USGS-VHP entry for the same eruption.
// Exported for unit tests.
export function dedupe(events: DisasterEvent[]): DisasterEvent[] {
  const kept: DisasterEvent[] = [];
  for (const e of events) {
    const dup = kept.find(
      (k) => k.type === e.type && k.lat != null && k.lon != null && e.lat != null && e.lon != null
        && haversineKm(k.lat, k.lon, e.lat, e.lon) <= 25,
    );
    if (!dup) kept.push(e); // events arrive severity-sorted, so the first kept wins
  }
  return kept;
}

// Coarse DoD-HADR-airlift relevance (0–100) — how likely an event is to draw a
// U.S. military humanitarian-airlift response, before factoring base proximity.
// GDACS's alertscore already blends hazard × population-exposure × country
// vulnerability, so use it when present; otherwise fall back to the red/orange
// level. Then weight by event type (sudden-onset events get airlift far more
// than slow-onset drought) and by AOR (partner-nation HADR is more likely in
// some commands; domestic NORTHCOM events flow through different channels).
// Awareness only — not a tasking or prediction model.
const HADR_TYPE_W: Record<DisasterEvent["type"], number> = {
  earthquake: 1, cyclone: 1, tsunami: 1, flood: 0.95,
  volcano: 0.8, epidemic: 0.6, wildfire: 0.5, drought: 0.4, other: 0.5,
};
const HADR_AOR_W: Partial<Record<DisasterEvent["aor"], number>> = {
  INDOPACOM: 1, SOUTHCOM: 1, AFRICOM: 1, CENTCOM: 0.95, EUCOM: 0.85, NORTHCOM: 0.8,
};
export function computeHadrScore(d: {
  type: DisasterEvent["type"];
  severity: DisasterEvent["severity"];
  aor: DisasterEvent["aor"];
  alertScore?: number | null;
}): number {
  const base =
    d.alertScore != null && Number.isFinite(d.alertScore)
      ? Math.min(Math.max(d.alertScore, 0) / 3, 1) * 70 // GDACS score is ~0–3
      : d.severity === "red" ? 60 : d.severity === "orange" ? 35 : 12;
  const scaled = base * (HADR_TYPE_W[d.type] ?? 0.5) * (HADR_AOR_W[d.aor] ?? 0.9);
  return Math.round(Math.min(100, scaled));
}

export async function getDisasters(): Promise<DisasterEvent[]> {
  const [gdacs, usgs, rw, tsunami, ash] = await Promise.all([
    fetchGdacs(), fetchUsgsQuakes(), fetchReliefWeb(), fetchTsunamiCenters(), fetchVolcanicAsh(),
  ]);
  const all: DisasterEvent[] = [...gdacs, ...usgs, ...rw, ...tsunami, ...ash].map((e) => {
    const aor = classifyAor({ lat: e.lat, lon: e.lon, name: e.country || e.title });
    return { ...e, aor, hadrScore: computeHadrScore({ type: e.type, severity: e.severity, aor, alertScore: e.alertScore }) };
  });
  all.sort((a, b) => {
    if (SEV_RANK[a.severity] !== SEV_RANK[b.severity]) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    return (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0);
  });
  return dedupe(all);
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
