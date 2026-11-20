// Server fetchers for the SITREP's icing and crosswind reads (lib/icingSignals,
// lib/crosswind — the judgement is there, PURE). Both sources are keyless and
// already on the app's host list:
//   - Open-Meteo pressure-level forecast at the field (temperature, relative
//     humidity and geopotential height at 1000–600 hPa, freezing level, the
//     weather code and the 10-m wind in knots), hourly, UTC, 4 days (icing reads 30 h; the 72-h outlook reads the rest).
//   - AWC PIREPs within 100 statute miles of the ICAO, last 3 h.
// Cached 30 min (profile, per rounded point) and 10 min (PIREPs, per ICAO);
// a failed read is held 2 min; every read is fail-safe → `live:false` with the
// reason, which every surface renders as UNKNOWN, never as no icing.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseFieldProfile, parsePireps, PROFILE_LEVELS, type FieldProfile, type Pirep } from "./icingSignals";

const UA = { "User-Agent": "DEAD-Dashboard/1.0", Accept: "application/json" };
const PROFILE_TTL = 30 * 60_000;
const PIREP_TTL = 10 * 60_000;
const FAIL_TTL = 2 * 60_000;

export function fieldProfileUrl(lat: number, lon: number): string {
  const lv = PROFILE_LEVELS.flatMap((p) => [`temperature_${p}hPa`, `relative_humidity_${p}hPa`, `geopotential_height_${p}hPa`]);
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&hourly=${["temperature_2m", "freezing_level_height", "weather_code", "precipitation", "wind_direction_10m", "wind_speed_10m", "wind_gusts_10m", "cloud_cover", "visibility", "precipitation_probability", ...lv].join(",")}` +
    `&wind_speed_unit=kn&timezone=GMT&forecast_days=4`;
}

export function pirepUrl(icao: string): string {
  return `https://aviationweather.gov/api/data/pirep?id=${encodeURIComponent(icao)}&distance=100&age=3&format=json`;
}

const profiles = new Map<string, { at: number; ttl: number; body: FieldProfile }>();

export async function getFieldProfile(lat: number, lon: number): Promise<FieldProfile> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = profiles.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.body;
  let body: FieldProfile;
  try {
    const res = await fetchWithTimeout(fieldProfileUrl(lat, lon), { headers: UA, cache: "no-store" }, 10_000);
    body = res.ok ? parseFieldProfile(await res.json()) : { live: false, elevationM: null, hours: [], reason: `Open-Meteo answered HTTP ${res.status}` };
  } catch (e) {
    body = { live: false, elevationM: null, hours: [], reason: `Open-Meteo unreachable (${e instanceof Error ? e.name : "error"})` };
  }
  if (profiles.size > 200) profiles.clear();
  profiles.set(key, { at: Date.now(), ttl: body.live ? PROFILE_TTL : FAIL_TTL, body });
  return body;
}

export interface PirepBody { live: boolean; items: Pirep[]; rows: number; reason: string | null }
const pireps = new Map<string, { at: number; ttl: number; body: PirepBody }>();

export async function getPireps(icao: string): Promise<PirepBody> {
  const id = icao.trim().toUpperCase();
  const hit = pireps.get(id);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.body;
  let body: PirepBody;
  try {
    const res = await fetchWithTimeout(pirepUrl(id), { headers: UA, cache: "no-store" }, 10_000);
    if (res.status === 204) body = { live: true, items: [], rows: 0, reason: null }; // AWC: no reports
    else if (!res.ok) body = { live: false, items: [], rows: 0, reason: `AWC PIREPs answered HTTP ${res.status}` };
    else {
      const text = await res.text();
      const json = text.trim() ? JSON.parse(text) : [];
      const p = parsePireps(json);
      body = { live: true, items: p.pireps, rows: p.rows, reason: null };
    }
  } catch (e) {
    body = { live: false, items: [], rows: 0, reason: `AWC PIREPs unreachable (${e instanceof Error ? e.name : "error"})` };
  }
  if (pireps.size > 200) pireps.clear();
  pireps.set(id, { at: Date.now(), ttl: body.live ? PIREP_TTL : FAIL_TTL, body });
  return body;
}

/** Owner diag: both fetches from production, with the first raw PIREP row and the profile's level count. */
export async function diagnoseFieldWx(icao: string, lat: number, lon: number): Promise<unknown> {
  const out: Record<string, unknown> = { icao };
  try {
    const res = await fetchWithTimeout(fieldProfileUrl(lat, lon), { headers: UA, cache: "no-store" }, 12_000);
    const text = await res.text();
    let parsed: FieldProfile | null = null;
    try { parsed = parseFieldProfile(JSON.parse(text)); } catch { /* not JSON */ }
    out.profile = {
      status: res.status, bytes: text.length, live: parsed?.live ?? false, elevationM: parsed?.elevationM ?? null,
      hours: parsed?.hours.length ?? 0, levelsFirstHour: parsed?.hours[0]?.levels.length ?? 0,
      snippet: parsed?.live ? undefined : text.slice(0, 300),
    };
  } catch (e) { out.profile = { status: 0, error: e instanceof Error ? e.message : String(e) }; }
  try {
    const res = await fetchWithTimeout(pirepUrl(icao), { headers: UA, cache: "no-store" }, 12_000);
    const text = await res.text();
    let json: unknown = null;
    try { json = text.trim() ? JSON.parse(text) : []; } catch { /* not JSON */ }
    const p = json != null ? parsePireps(json) : { pireps: [], rows: 0 };
    const first = Array.isArray(json) ? json[0] : (json as { features?: unknown[] } | null)?.features?.[0];
    out.pireps = {
      status: res.status, bytes: text.length, rows: p.rows, parsed: p.pireps.length,
      withIcing: p.pireps.filter((x) => x.intensity).length,
      rawFirst: first ? JSON.stringify(first).slice(0, 1200) : null,
      snippet: json == null ? text.slice(0, 300) : undefined,
    };
  } catch (e) { out.pireps = { status: 0, error: e instanceof Error ? e.message : String(e) }; }
  return out;
}
