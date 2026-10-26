// OpenSky Network — PURE parsers and rules, client-safe, tested in
// tests/openskySignals.test.ts. lib/opensky.ts fetches.
//
// OpenSky's anonymous `states/all` is the FALLBACK for the I&W mobility
// sensor when the keyless community military mirrors (airplanes.live /
// adsb.lol) are down. It is a weaker instrument on purpose and every
// consumer says so: state vectors carry NO aircraft type, so "mobility /
// tanker" cannot be told from a fighter or a helicopter — an aircraft is
// counted as military only by its ICAO 24-bit address range (US military
// AE0000–AFFFFF) or a known mobility / mil callsign prefix. The anonymous
// tier is also rationed: 400 credits a day, a bounding-box query costing 1–4
// credits by its area (OpenSky's own table), so lib/opensky.ts keeps a
// daily budget and the sensor never runs it while the mirrors answer.

export interface OpenSkyState {
  icao24: string;
  callsign: string;
  country: string;
  lat: number;
  lon: number;
  onGround: boolean;
  /** Military by ICAO range or callsign — the only attribution a state vector allows. */
  mil: boolean;
}

export interface Bbox { latMin: number; latMax: number; lonMin: number; lonMax: number }

/** US military block of the ICAO 24-bit address space. */
const MIL_ICAO_PREFIXES = ["ae", "af"];
/** Mobility / tanker / mil callsign prefixes seen on the open feeds. */
export const MIL_CALLSIGN_RE = /^(REACH|RCH|HAVOC|BLUE\d+|KING\d+|EVAC|HOBO|SAM\d+|MAGMA|GULF|VENUS|ANVIL|VICTUS|VADER|TREK|HEAVY|FORCE|SPAR|PETRO|LIME|ASPEN|FLAP|CASH|TANGO|BISON|PAT\d+|CONVOY|UNDIE|JOKER|PIKE|BRUTE|RAVEN|SHARK|TITUS|VECTOR|MAGNUM|EAGLE|HERKY|ROCKY|GOTHIC|VOODOO|SCALP|GRIM|RRR\d|CFC\d|ASCOT|NATO|BAF\d|GAF\d|FAF\d|IAM\d|RFR\d|CTM\d|DUKE|QID\d|TOPCAT|OPEC|ETHYL|PACK|LAGR|MOOSE|DOOM|SODA|TORCH|CHAOS|TEAL|OMNI\d|CNV\d)/i;

export function isMilitaryAircraft(icao24: string, callsign: string): boolean {
  const i = (icao24 ?? "").toLowerCase();
  if (i && MIL_ICAO_PREFIXES.some((p) => i.startsWith(p))) return true;
  const c = (callsign ?? "").trim();
  return !!c && MIL_CALLSIGN_RE.test(c);
}

/** `states/all` JSON → state vectors. Rows without a position are dropped. */
export function parseOpenSkyStates(json: unknown): OpenSkyState[] {
  const states = (json as { states?: unknown[] })?.states;
  if (!Array.isArray(states)) return [];
  const out: OpenSkyState[] = [];
  for (const raw of states) {
    if (!Array.isArray(raw)) continue;
    const s = raw as unknown[];
    const lon = s[5], lat = s[6];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const icao24 = String(s[0] ?? "").toLowerCase().trim();
    const callsign = String(s[1] ?? "").trim();
    out.push({ icao24, callsign, country: String(s[2] ?? ""), lat, lon, onGround: !!s[8], mil: isMilitaryAircraft(icao24, callsign) });
  }
  return out;
}

/** OpenSky's credit cost of one bounding-box query, by area in square
 *  degrees: 0–25 → 1, 25–100 → 2, 100–400 → 3, more → 4. */
export function bboxCredits(b: Bbox): number {
  const area = Math.max(0, b.latMax - b.latMin) * Math.max(0, b.lonMax - b.lonMin);
  return area <= 25 ? 1 : area <= 100 ? 2 : area <= 400 ? 3 : 4;
}

/** The anonymous tier allows 400 a day; the sensor keeps well under it so
 *  the OSINT feed pane's "AOR contacts" strip (the other consumer) is never
 *  starved. */
export const OPENSKY_DAILY_BUDGET = 150;

export function bboxKey(b: Bbox): string {
  return [b.latMin, b.latMax, b.lonMin, b.lonMax].map((x) => x.toFixed(2)).join(",");
}
