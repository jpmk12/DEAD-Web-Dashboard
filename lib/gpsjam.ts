// GPS interference / EW awareness via GPSJam (gpsjam.org). GPSJam aggregates
// ADS-B navigation-accuracy degradation into H3 resolution-4 hexes, published
// daily (~04:00 UTC, prior day). Extracted from the /api/osint/gpsjam route so
// both the Crisis map's "GPS" layer AND the Force Protection scorer can use it:
// the map renders elevated cells, the scorer tests whether a base sits in one.
//
// Coarse OSINT, not authoritative. The daily file is CSV; column spellings vary
// across GPSJam's history, so the header is fuzzy-matched. Pure fetch + parse +
// h3 point lookup — no new dependency (h3-js already ships for the map).

import { latLngToCell } from "h3-js";

export interface GpsHex { h3: string; level: number } // 1 = moderate, 2 = high

const TTL = 60 * 60 * 1000; // daily data → 1 h cache
let cache: { hexes: GpsHex[]; date: string; expires: number } | null = null;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function fetchDay(date: string): Promise<string | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`https://gpsjam.org/data/${date}-h3_4.csv`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)", Accept: "text/csv,*/*" },
      cache: "no-store",
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// Minimal CSV split that tolerates quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Pure CSV → elevated cells. Exported for unit tests.
export function parseGpsCsv(csv: string): GpsHex[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const find = (pred: (h: string) => boolean) => headers.findIndex(pred);
  const hexCol = find((h) => h === "hex" || h === "h3" || h === "cell" || h.includes("hex") || h.includes("h3"));
  const badCol = find((h) => h.includes("bad"));
  const goodCol = find((h) => h.includes("good"));
  const fracCol = find((h) => h.includes("frac") || h.includes("fraction"));
  const totalCol = find((h) => h === "count" || h === "total" || h === "n" || h === "num");
  if (hexCol < 0) return [];

  const out: GpsHex[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const h3 = String(cells[hexCol] ?? "").trim();
    if (!h3 || h3.length < 8) continue;
    const bad = badCol >= 0 ? Number(cells[badCol]) : NaN;
    const good = goodCol >= 0 ? Number(cells[goodCol]) : NaN;
    const total = totalCol >= 0 ? Number(cells[totalCol]) : NaN;
    const fracDirect = fracCol >= 0 ? Number(cells[fracCol]) : NaN;
    const denom = Number.isFinite(good) && Number.isFinite(bad) ? good + bad
      : Number.isFinite(total) ? total : NaN;
    const bf = Number.isFinite(fracDirect) ? fracDirect
      : Number.isFinite(bad) && Number.isFinite(denom) && denom > 0 ? bad / denom
      : NaN;
    if (!Number.isFinite(bf)) continue;
    const level = bf >= 0.5 ? 2 : bf >= 0.15 ? 1 : 0;
    if (level >= 1) out.push({ h3, level });
  }
  return out.slice(0, 2500);
}

// Today's (or yesterday's) elevated cells, with the date actually used. ok:false
// means upstream was unreachable — NOT "no interference".
export async function getGpsInterference(): Promise<{ ok: boolean; hexes: GpsHex[]; date: string }> {
  if (cache && cache.expires > Date.now()) return { ok: true, hexes: cache.hexes, date: cache.date };
  const today = ymd(new Date());
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  let date = today;
  let csv = await fetchDay(today);
  if (csv == null) { csv = await fetchDay(yesterday); date = yesterday; }
  if (csv == null) return { ok: false, hexes: [], date: today };
  const hexes = parseGpsCsv(csv);
  if (hexes.length > 0) cache = { hexes, date, expires: Date.now() + TTL };
  return { ok: true, hexes, date };
}

// GPS interference level at a point: resolve its res-4 cell, look it up in the
// elevated set. 0 = none reported. A Set is built once per call for O(1) lookup.
export function gpsLevelAt(lat: number, lon: number, hexes: GpsHex[]): number {
  if (hexes.length === 0) return 0;
  let cell: string;
  try {
    cell = latLngToCell(lat, lon, 4);
  } catch {
    return 0;
  }
  const hit = hexes.find((h) => h.h3 === cell);
  return hit ? hit.level : 0;
}
