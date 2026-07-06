// PURE parsers + rollups for the SITREP Infrastructure card. Client-safe
// (no fetch, no node:*) — the fetchers live in lib/infra.ts (server-only).
// Contracts pinned from a LIVE prod capture of /api/sitrep/infra-diag
// (2026-07-06): IODA entities/signals JSON, USGS WaterML JSON, FAA NAS XML.
// Unit-tested against those samples.

import type { Led } from "./sitrepSignals";

// ─── IODA (Internet Outage Detection & Analysis, Georgia Tech) ──────────────

export interface IodaEntity {
  code: string;
  name: string;
}

// entities.lookup → data[]: [{ code, name, type, attrs: {...} }]
export function parseIodaEntities(json: unknown, want?: string): IodaEntity | null {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({ code: String(e.code ?? ""), name: String(e.name ?? "") }))
    .filter((e) => e.code && e.name);
  if (rows.length === 0) return null;
  if (want) {
    const exact = rows.find((r) => r.name.toLowerCase() === want.toLowerCase());
    if (exact) return exact;
  }
  return rows[0];
}

export interface IodaSeries {
  datasource: string;
  label: string;
  latest: number | null;      // recent level (median of last non-null points)
  baseline: number | null;    // 24h baseline (median of earlier points)
  dropPct: number | null;     // 0-100; null when no baseline
}

const IODA_LABELS: Record<string, string> = {
  bgp: "BGP routes",
  "ping-slash24": "Active probing",
  "merit-nt": "Darknet",
  gtr: "Google traffic",
};

const median = (arr: number[]): number => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// signals/raw → data: [[{ datasource, values: (number|null)[], step, … }, …]]
// (array-of-arrays, one inner array per queried entity — parsed defensively
// to also accept a flat array). Model-output series (*-sarima, *-norm) are
// skipped; only raw measurement sources drive the read.
export function parseIodaSignals(json: unknown): IodaSeries[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const flat: unknown[] = [];
  for (const e of data) {
    if (Array.isArray(e)) flat.push(...e);
    else flat.push(e);
  }
  const out: IodaSeries[] = [];
  for (const s of flat) {
    if (typeof s !== "object" || s === null) continue;
    const r = s as Record<string, unknown>;
    const ds = String(r.datasource ?? "");
    if (!ds || /-(sarima|norm)$/.test(ds)) continue;
    const values = Array.isArray(r.values)
      ? r.values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
      : [];
    const nn = values.filter((v): v is number => v !== null);
    const label = IODA_LABELS[ds] ?? ds;
    if (nn.length < 4) {
      out.push({ datasource: ds, label, latest: nn.length ? nn[nn.length - 1] : null, baseline: null, dropPct: null });
      continue;
    }
    // Baseline = median of the first 3/4 of the window; latest = median of the
    // last few points (trailing ingest lag shows as nulls and is already gone).
    const cut = Math.max(1, Math.floor(nn.length * 0.75));
    const baseline = median(nn.slice(0, cut));
    const latest = median(nn.slice(-Math.min(6, nn.length - cut > 0 ? nn.length - cut : 1)));
    const dropPct = baseline > 0 ? Math.max(0, Math.round((1 - latest / baseline) * 100)) : null;
    out.push({ datasource: ds, label, latest, baseline, dropPct });
  }
  return out;
}

// Planning-grade heuristic, not an outage oracle: one source can glitch on its
// own, so RED needs corroboration (two sources ≥80% down, or one near-total).
export function internetLed(series: IodaSeries[]): Led {
  const scored = series.filter((s) => s.dropPct !== null);
  if (scored.length === 0) return "u";
  const severe = scored.filter((s) => (s.dropPct ?? 0) >= 80);
  if (severe.length >= 2 || scored.some((s) => (s.dropPct ?? 0) >= 95)) return "r";
  if (scored.some((s) => (s.dropPct ?? 0) >= 50)) return "a";
  return "g";
}

// ─── USGS water gauges (WaterML IV service) ─────────────────────────────────

export interface UsgsGauge {
  site: string;
  stageFt: number | null;
  time: string;   // ISO-ish as reported
}

// value.timeSeries[]: { sourceInfo: { siteName }, variable: { noDataValue },
//   values: [{ value: [{ value, dateTime }] }] }
export function parseUsgsGauges(json: unknown): UsgsGauge[] {
  const ts = (json as { value?: { timeSeries?: unknown } } | null)?.value?.timeSeries;
  if (!Array.isArray(ts)) return [];
  const out: UsgsGauge[] = [];
  for (const t of ts) {
    if (typeof t !== "object" || t === null) continue;
    const r = t as {
      sourceInfo?: { siteName?: unknown };
      variable?: { noDataValue?: unknown };
      values?: { value?: { value?: unknown; dateTime?: unknown }[] }[];
    };
    const site = String(r.sourceInfo?.siteName ?? "").trim();
    if (!site) continue;
    const point = r.values?.[0]?.value?.[0];
    const noData = Number(r.variable?.noDataValue ?? -999999);
    let stageFt: number | null = null;
    if (point) {
      const v = Number(point.value);
      if (Number.isFinite(v) && v !== noData) stageFt = v;
    }
    out.push({ site, stageFt, time: String(point?.dateTime ?? "") });
  }
  return out;
}

// ─── FAA NAS status (nasstatus.faa.gov XML) ─────────────────────────────────

export type NasKind = "groundStop" | "groundDelay" | "closure" | "delay";

export interface NasProgram {
  kind: NasKind;
  airport: string;   // FAA LID, e.g. "PHL"
  reason: string;
  detail: string;    // end time / avg delay / reopen — whatever the type carries
}

export interface NasStatus {
  updated: string | null;
  programs: NasProgram[];
}

const tagText = (block: string, name: string): string => {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
};

const blocks = (xml: string, name: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
};

// <AIRPORT_STATUS_INFORMATION> → Delay_type sections, each carrying one list
// class. Regex-parsed (no DOM dep). Unknown sections are ignored, never fatal.
export function parseFaaNas(xml: string): NasStatus {
  if (!xml || !xml.includes("<AIRPORT_STATUS_INFORMATION")) return { updated: null, programs: [] };
  const updated = tagText(xml, "Update_Time") || null;
  const programs: NasProgram[] = [];

  for (const section of blocks(xml, "Delay_type")) {
    if (section.includes("<Ground_Stop_List>")) {
      for (const p of blocks(section, "Program")) {
        const end = tagText(p, "End_Time");
        programs.push({ kind: "groundStop", airport: tagText(p, "ARPT"), reason: tagText(p, "Reason"), detail: end ? `until ${end}` : "" });
      }
    } else if (section.includes("<Ground_Delay_List>")) {
      for (const p of blocks(section, "Ground_Delay")) {
        const avg = tagText(p, "Avg");
        const max = tagText(p, "Max");
        programs.push({ kind: "groundDelay", airport: tagText(p, "ARPT"), reason: tagText(p, "Reason"), detail: [avg && `avg ${avg}`, max && `max ${max}`].filter(Boolean).join(" · ") });
      }
    } else if (section.includes("<Airport_Closure_List>")) {
      for (const p of blocks(section, "Airport")) {
        const reopen = tagText(p, "Reopen");
        programs.push({ kind: "closure", airport: tagText(p, "ARPT"), reason: tagText(p, "Reason"), detail: reopen ? `reopen ${reopen}` : "" });
      }
    } else if (section.includes("<Arrival_Departure_Delay_List>")) {
      for (const p of blocks(section, "Delay")) {
        const type = p.match(/<Arrival_Departure\s+Type="([^"]+)"/)?.[1] ?? "";
        const min = tagText(p, "Min");
        const max = tagText(p, "Max");
        programs.push({ kind: "delay", airport: tagText(p, "ARPT"), reason: tagText(p, "Reason"), detail: [type, min && max ? `${min}–${max}` : min || max].filter(Boolean).join(" ") });
      }
    }
  }
  return { updated, programs: programs.filter((p) => p.airport) };
}

export interface NasNearby extends NasProgram {
  km: number;
}

// The base itself is usually a mil field the NAS board never lists, so a
// nearby civil closure/ground stop reads as regional airspace stress (amber),
// not a base outage — unless the board names the base's own field.
export function nasLed(live: boolean, nearby: NasNearby[], baseIcao: string): Led {
  if (!live) return "u";
  const ownLid = baseIcao.replace(/^K/, "");
  if (nearby.some((p) => p.kind === "closure" && p.airport === ownLid)) return "r";
  if (nearby.some((p) => p.kind === "closure" || p.kind === "groundStop")) return "a";
  return "g";
}

// ─── News-derived utility buckets (no sensor — labeled as such in the UI) ───

export interface InfraNewsSplit<T> {
  power: T[];
  water: T[];
  comms: T[];
}

const POWER_TERMS = new Set(["power outage", "outage", "blackout", "power restored"]);
const WATER_TERMS = new Set(["water main", "boil water", "water service", "flood", "flooding"]);
const COMMS_TERMS = new Set(["internet", "cell service", "cellular", "fiber cut"]);

export function splitInfraNews<T extends { matched: string[] }>(news: T[]): InfraNewsSplit<T> {
  const power: T[] = [];
  const water: T[] = [];
  const comms: T[] = [];
  for (const n of news) {
    if (n.matched.some((t) => POWER_TERMS.has(t))) power.push(n);
    if (n.matched.some((t) => WATER_TERMS.has(t))) water.push(n);
    if (n.matched.some((t) => COMMS_TERMS.has(t))) comms.push(n);
  }
  return { power, water, comms };
}

// ─── Rollup ──────────────────────────────────────────────────────────────────

// Worst of the sensor axes; power/comms news can raise to amber (never red —
// unverified single-source reporting). UNKNOWN only when NO sensor reported.
export function infraLed(internet: Led, nas: Led | null, powerNewsCount: number, commsNewsCount: number): Led {
  const RANK: Record<Led, number> = { u: 0, g: 1, a: 2, r: 3 };
  const sensors = [internet, ...(nas ? [nas] : [])];
  const reporting = sensors.filter((l) => l !== "u");
  if (reporting.length === 0) return "u";
  let worst: Led = "g";
  for (const l of reporting) if (RANK[l] > RANK[worst]) worst = l;
  if (worst === "g" && (powerNewsCount > 0 || commsNewsCount > 0)) return "a";
  return worst;
}
