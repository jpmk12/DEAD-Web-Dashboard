// The sensor_daily key namespace — PURE. Every numeric daily series the app
// records is named here, with its DAY POLICY, so a key cannot be invented at
// a call site and the list IS the documentation (the lib/icons.tsx rule:
// one home, one meaning).
//
// Policies (docs/PLAN-TREND-LEARNING.md §2.4):
//   peak — counts and severities keep the day's highest value (the
//          mobility_count rule: a surge at 0900Z that recedes by 1500Z is
//          still that day's fact).
//   last — states and prices keep the latest value (crew availability at
//          0900 that changes by 1500 is not "the day's peak availability").

export type DayPolicy = "peak" | "last";

export interface SensorKeyDef { prefix: string; policy: DayPolicy; what: string }

export const SENSOR_KEYS: readonly SensorKeyDef[] = [
  // I&W spectrum sensors (cyber/space build)
  { prefix: "pnt",      policy: "peak", what: "GPSJam cells inside an AOI bbox, per problem id" },
  { prefix: "ransom",   policy: "peak", what: "ransomware victims relevant to an AOI, per problem id" },
  // Phase C — per-hub lift and chokepoint acts
  { prefix: "mob",      policy: "peak", what: "mobility aircraft within hub radius, per ICAO" },
  { prefix: "tanker",   policy: "peak", what: "tanker aircraft within hub radius, per ICAO" },
  { prefix: "cpact",    policy: "peak", what: "1 on a day the chokepoint read holds a reported act, per chokepoint id" },
  // Phase B/D — base tempo
  { prefix: "fc",       policy: "peak", what: "observed METAR flight category ordinal (VFR 0 … LIFR 3), per ICAO" },
  { prefix: "taf",      policy: "peak", what: "worst TAF category ordinal forecast for the day, per ICAO" },
  { prefix: "notam",    policy: "peak", what: "active NOTAM count, per ICAO" },
  { prefix: "rwyclose", policy: "peak", what: "1 on a day with a runway-closure window, per ICAO" },
  { prefix: "xwind",    policy: "peak", what: "max crosswind component kt, per ICAO" },
  { prefix: "limfac",   policy: "peak", what: "1 on a day a function read PMC/NMC, per ICAO:function" },
  // Phase E — spectrum environment and markets
  { prefix: "swx",      policy: "peak", what: "NOAA scale ordinal observed that day, G | R | S" },
  { prefix: "kev",      policy: "peak", what: "KEVs added that day naming a declared vendor, per vendor slug" },
  { prefix: "outage",   policy: "peak", what: "max IODA alert level ordinal, per tracked country slug" },
  { prefix: "px",       policy: "last", what: "daily close, per symbol" },
];

const BY_PREFIX = new Map(SENSOR_KEYS.map((k) => [k.prefix, k]));

/** Build a registered key. Parts are lower-cased and slugged (`:`-safe). */
export function sensorKey(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts.map(slug)].join(":");
}

export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9=.+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}

/** The registered definition for a key, or null when its prefix is unknown. */
export function sensorKeyDef(key: string): SensorKeyDef | null {
  const prefix = key.split(":")[0];
  return BY_PREFIX.get(prefix) ?? null;
}

export function isRegisteredSensorKey(key: string): boolean {
  return sensorKeyDef(key) != null;
}
