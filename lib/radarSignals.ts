// Cloudflare Radar — PURE parsers and the outage-level rule, client-safe,
// tested in tests/radarSignals.test.ts. lib/cloudflareRadar.ts fetches (a
// Bearer token from CLOUDFLARE_RADAR_TOKEN; the token never leaves the
// server and never appears in a prompt, a log line or a reply).
//
// Two endpoints, both published JSON:
//   GET /radar/annotations/outages   — Cloudflare's curated internet
//       outage annotations: scope (NATIONWIDE / REGIONAL / NETWORK /
//       PLATFORM), cause (GOVERNMENT_DIRECTED, MILITARY_ACTION,
//       CYBERATTACK, CABLE_CUT, POWER_OUTAGE, …), the countries, start and
//       (null while ongoing) end, and a linked write-up.
//   GET /radar/traffic_anomalies     — detected traffic drops per location
//       or AS, VERIFIED or UNVERIFIED.
//
// The level rule (`radarOutageLevel`): an ONGOING NATIONWIDE outage whose
// cause is a hostile or governmental act (military action / government
// directed / cyberattack) is RED — that is the connectivity picture of a
// country under attack or a shutdown; any other ongoing annotation, or a
// VERIFIED traffic anomaly, is AMBER; one that ENDED inside the window is a
// NOTE (still shown, never colours a cell); nothing is green by itself —
// the caller says green only when the feed ANSWERED. IODA (Georgia Tech)
// remains the first outage source; Radar is the second, independent one,
// so the USCYBERCOM Outages cell can say "two sources" instead of one.
//
// Data © Cloudflare, CC BY-NC 4.0 — attribution is rendered wherever shown.

export type RadarScope = "NATIONWIDE" | "REGIONAL" | "NETWORK" | "PLATFORM" | "UNKNOWN";

export interface RadarOutage {
  id: string;
  /** Cloudflare's own description line. */
  description: string;
  scope: RadarScope;
  /** Cloudflare's cause code, upper-cased (`MILITARY_ACTION` …), or "". */
  cause: string;
  /** ISO alpha-2 codes + names the annotation names. */
  countries: { code: string; name: string }[];
  /** ASNs named (for a NETWORK-scope annotation). */
  asns: number[];
  startMs: number;
  /** null while the outage is ongoing. */
  endMs: number | null;
  url: string | null;
}

export interface RadarAnomaly {
  id: string;
  type: "LOCATION" | "AS";
  status: "VERIFIED" | "UNVERIFIED";
  country: { code: string; name: string } | null;
  asn: number | null;
  startMs: number;
  endMs: number | null;
}

const HOSTILE_CAUSES = new Set(["MILITARY_ACTION", "GOVERNMENT_DIRECTED", "CYBERATTACK"]);

const ms = (s: unknown): number | null => {
  if (typeof s !== "string" || !s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
const str = (s: unknown): string => (typeof s === "string" ? s.trim() : "");
const httpsOnly = (s: unknown): string | null => (typeof s === "string" && /^https:\/\//i.test(s) ? s.trim().slice(0, 300) : null);

function countriesOf(codes: unknown, details: unknown): { code: string; name: string }[] {
  const out = new Map<string, string>();
  if (Array.isArray(details)) for (const d of details) {
    const code = str((d as { code?: unknown })?.code).toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) out.set(code, str((d as { name?: unknown })?.name) || code);
  }
  if (Array.isArray(codes)) for (const c of codes) {
    const code = str(c).toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && !out.has(code)) out.set(code, code);
  }
  return [...out.entries()].map(([code, name]) => ({ code, name }));
}

/** `result.annotations[]` → outages. A row with no start date or no id is
 *  dropped — never guessed. */
export function parseRadarOutages(json: unknown): RadarOutage[] {
  const rows = (json as { result?: { annotations?: unknown[] } })?.result?.annotations;
  if (!Array.isArray(rows)) return [];
  const out: RadarOutage[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.id);
    const startMs = ms(r.startDate);
    if (!id || startMs == null) continue;
    const outage = (r.outage ?? {}) as { outageCause?: unknown; outageType?: unknown };
    const scopeRaw = str(outage.outageType).toUpperCase();
    const scope: RadarScope = scopeRaw === "NATIONWIDE" || scopeRaw === "REGIONAL" || scopeRaw === "NETWORK" || scopeRaw === "PLATFORM" ? scopeRaw : "UNKNOWN";
    out.push({
      id,
      description: str(r.description).slice(0, 400),
      scope,
      cause: str(outage.outageCause).toUpperCase().slice(0, 40),
      countries: countriesOf(r.locations, r.locationsDetails),
      asns: Array.isArray(r.asns) ? (r.asns as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
      startMs,
      endMs: ms(r.endDate),
      url: httpsOnly(r.linkedUrl),
    });
  }
  return out.sort((a, b) => b.startMs - a.startMs);
}

/** `result.trafficAnomalies[]` → anomalies. */
export function parseRadarAnomalies(json: unknown): RadarAnomaly[] {
  const rows = (json as { result?: { trafficAnomalies?: unknown[] } })?.result?.trafficAnomalies;
  if (!Array.isArray(rows)) return [];
  const out: RadarAnomaly[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.uuid) || str(r.id);
    const startMs = ms(r.startDate);
    const typeRaw = str(r.type).toUpperCase();
    if (!id || startMs == null || (typeRaw !== "LOCATION" && typeRaw !== "AS")) continue;
    const ld = r.locationDetails as { code?: unknown; name?: unknown } | undefined;
    const code = str(ld?.code).toUpperCase();
    const ad = r.asnDetails as { asn?: unknown } | undefined;
    const asn = Number(ad?.asn);
    out.push({
      id, type: typeRaw,
      status: str(r.status).toUpperCase() === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
      country: /^[A-Z]{2}$/.test(code) ? { code, name: str(ld?.name) || code } : null,
      asn: Number.isInteger(asn) && asn > 0 ? asn : null,
      startMs, endMs: ms(r.endDate),
    });
  }
  return out.sort((a, b) => b.startMs - a.startMs);
}

export type RadarLevel = "red" | "amber" | "note";

export interface RadarCountryRead {
  /** ISO2. */
  code: string;
  /** The display name the feed gave (or the caller's). */
  name: string;
  level: RadarLevel;
  /** Why, in one line — scope · cause · since / ended. */
  why: string;
  ongoing: boolean;
  outages: RadarOutage[];
  anomalies: RadarAnomaly[];
  url: string | null;
}

const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const niceCause = (c: string) => (c ? c.toLowerCase().replace(/_/g, " ") : "cause not stated");

/** The level of one outage annotation at `nowMs`. */
export function radarOutageLevel(o: RadarOutage, nowMs: number): RadarLevel {
  const ongoing = o.endMs == null || o.endMs > nowMs;
  if (!ongoing) return "note";
  if (o.scope === "NATIONWIDE" && HOSTILE_CAUSES.has(o.cause)) return "red";
  return "amber";
}

const RANK: Record<RadarLevel, number> = { note: 0, amber: 1, red: 2 };

/**
 * Per-country read for the countries asked for (ISO2 codes, upper-cased),
 * over the outages and VERIFIED anomalies that name them. Unverified
 * anomalies are listed but never colour. A country with nothing is absent
 * from the result — the CALLER decides whether absent means green (the feed
 * answered) or UNKNOWN (it did not).
 */
export function radarReadsFor(outages: RadarOutage[], anomalies: RadarAnomaly[], codes: string[], nowMs: number, windowDays = 7): RadarCountryRead[] {
  const want = new Set(codes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)));
  const since = nowMs - windowDays * 86_400_000;
  const by = new Map<string, RadarCountryRead>();
  const get = (code: string, name: string) => {
    let r = by.get(code);
    if (!r) { r = { code, name, level: "note", why: "", ongoing: false, outages: [], anomalies: [], url: null }; by.set(code, r); }
    return r;
  };
  for (const o of outages) {
    if (o.startMs < since && o.endMs != null && o.endMs < since) continue;
    for (const c of o.countries) {
      if (!want.has(c.code)) continue;
      const r = get(c.code, c.name);
      r.outages.push(o);
      const lvl = radarOutageLevel(o, nowMs);
      if (RANK[lvl] > RANK[r.level] || !r.why) {
        r.level = lvl;
        const ongoing = lvl !== "note";
        r.why = `${o.scope === "UNKNOWN" ? "outage" : o.scope.toLowerCase() + " outage"} · ${niceCause(o.cause)} · ${ongoing ? `since ${fmtDay(o.startMs)}` : `ended ${fmtDay(o.endMs!)}`}`;
        r.ongoing = r.ongoing || ongoing;
        r.url = o.url ?? r.url;
      }
    }
  }
  for (const a of anomalies) {
    if (a.type !== "LOCATION" || !a.country || !want.has(a.country.code)) continue;
    if (a.startMs < since && a.endMs != null && a.endMs < since) continue;
    const r = get(a.country.code, a.country.name);
    r.anomalies.push(a);
    const ongoing = a.endMs == null || a.endMs > nowMs;
    if (a.status === "VERIFIED" && ongoing && RANK.amber > RANK[r.level]) {
      r.level = "amber";
      r.why = `verified traffic anomaly · since ${fmtDay(a.startMs)}`;
      r.ongoing = true;
    } else if (!r.why) {
      r.why = `${a.status.toLowerCase()} traffic anomaly · ${ongoing ? `since ${fmtDay(a.startMs)}` : `ended ${fmtDay(a.endMs!)}`}`;
    }
  }
  return [...by.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || a.name.localeCompare(b.name));
}

/** Ordinal for the daily series (`cfout:<iso2>`, day-peak): 3 red · 2 amber · 1 note · 0 nothing. */
export const RADAR_LEVEL_ORDINAL: Record<RadarLevel, number> = { red: 3, amber: 2, note: 1 };
