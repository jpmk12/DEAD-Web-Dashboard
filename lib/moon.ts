// Lunar illumination windows for operations planning — PURE, client-safe,
// dependency-free, unit-tested. (Weather tab "Lunar windows" card, the
// Glance tonight line, the light-data export.)
//
// What it answers: for each NIGHT at a place — the dark period from EENT
// (end of evening nautical twilight) to BMNT (begin morning nautical
// twilight), the OPORD light-data convention — how much of that darkness
// the moon is UP for, how much of it the moon is USEFULLY up for (≥
// MOON_USEFUL_ALT_DEG above the horizon — a 90% moon on the horizon lights
// nothing), how much is moon-free, and the illuminated fraction. Percent
// illumination alone misleads: a 97% moon that sets at 0550 leaves half an
// hour of moon-free dark; a 20% moon that rises at 0227 leaves eight.
//
// Maths: Paul Schlyter's low-precision Sun and Moon (the "How to compute
// planetary positions" series — the 12 largest lunar perturbation terms),
// horizon crossings by a 10-minute scan + bisection, illumination from the
// Sun–Moon elongation. Planning-grade: rise/set to a minute or two, not an
// almanac; polar nights return nulls, never fake times. Sun times here
// agree with lib/astro.ts (NOAA) within a few minutes — astro.ts stays the
// SITREP's source; this module exists for the night budget and the moon.

import { addDays, zoneDayStartMs } from "./effectiveZone";

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Schlyter's day number: days since 1999-12-31 00:00 UT (JD 2451543.5). */
const D0_MS = Date.UTC(1999, 11, 31);
const norm360 = (x: number) => ((x % 360) + 360) % 360;
const sinD = (x: number) => Math.sin(x * RAD);
const cosD = (x: number) => Math.cos(x * RAD);

export const MOON_USEFUL_ALT_DEG = 30;
/** Rise/set altitudes (degrees). Moon: upper limb with refraction AND
 *  parallax folded in, against the GEOCENTRIC altitude (Schlyter's +0.125°).
 *  Sun: upper limb with refraction; twilights are the centre. */
const H0_MOON = 0.125;
const H0_SUN = -0.833;
const H0_NAUTICAL = -12;

interface Equatorial { ra: number; dec: number; /** geocentric distance (Earth radii for the Moon, AU for the Sun) */ r: number; lon: number; lat: number }

/** Geocentric Sun — ecliptic longitude and equatorial coordinates. */
export function sunPosition(ms: number): Equatorial {
  const d = (ms - D0_MS) / DAY_MS;
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = norm360(356.047 + 0.9856002585 * d);
  const ecl = 23.4393 - 3.563e-7 * d;
  const E = M + (180 / Math.PI) * e * sinD(M) * (1 + e * cosD(M));
  const xv = cosD(E) - e, yv = Math.sqrt(1 - e * e) * sinD(E);
  const v = Math.atan2(yv, xv) / RAD, r = Math.hypot(xv, yv);
  const lon = norm360(v + w);
  const xs = r * cosD(lon), ys = r * sinD(lon);
  const xe = xs, ye = ys * cosD(ecl), ze = ys * sinD(ecl);
  return { ra: norm360(Math.atan2(ye, xe) / RAD), dec: Math.atan2(ze, Math.hypot(xe, ye)) / RAD, r, lon, lat: 0 };
}

/** Geocentric Moon with the main perturbations. `r` in Earth radii. */
export function moonPosition(ms: number): Equatorial {
  const d = (ms - D0_MS) / DAY_MS;
  const N = norm360(125.1228 - 0.0529538083 * d);
  const i = 5.1454;
  const w = norm360(318.0634 + 0.1643573223 * d);
  const a = 60.2666;
  const e = 0.0549;
  const M = norm360(115.3654 + 13.0649929509 * d);
  let E = M + (180 / Math.PI) * e * sinD(M) * (1 + e * cosD(M));
  for (let k = 0; k < 10; k++) {
    const E1 = E - (E - (180 / Math.PI) * e * sinD(E) - M) / (1 - e * cosD(E));
    if (Math.abs(E1 - E) < 0.001) { E = E1; break; }
    E = E1;
  }
  const xv = a * (cosD(E) - e), yv = a * Math.sqrt(1 - e * e) * sinD(E);
  const v = Math.atan2(yv, xv) / RAD, rr = Math.hypot(xv, yv);
  const vw = v + w;
  const xh = rr * (cosD(N) * cosD(vw) - sinD(N) * sinD(vw) * cosD(i));
  const yh = rr * (sinD(N) * cosD(vw) + cosD(N) * sinD(vw) * cosD(i));
  const zh = rr * sinD(vw) * sinD(i);
  let lon = norm360(Math.atan2(yh, xh) / RAD);
  let lat = Math.atan2(zh, Math.hypot(xh, yh)) / RAD;
  let r = rr;
  // Perturbations (Schlyter): arguments from the Sun's and Moon's mean elements.
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = norm360(356.047 + 0.9856002585 * d);
  const Ls = norm360(Ms + ws);
  const Lm = norm360(M + w + N);
  const D = norm360(Lm - Ls);
  const F = norm360(Lm - N);
  lon += -1.274 * sinD(M - 2 * D) + 0.658 * sinD(2 * D) - 0.186 * sinD(Ms) - 0.059 * sinD(2 * M - 2 * D)
    - 0.057 * sinD(M - 2 * D + Ms) + 0.053 * sinD(M + 2 * D) + 0.046 * sinD(2 * D - Ms) + 0.041 * sinD(M - Ms)
    - 0.035 * sinD(D) - 0.031 * sinD(M + Ms) - 0.015 * sinD(2 * F - 2 * D) + 0.011 * sinD(M - 4 * D);
  lat += -0.173 * sinD(F - 2 * D) - 0.055 * sinD(M - F - 2 * D) - 0.046 * sinD(M + F - 2 * D) + 0.033 * sinD(F + 2 * D) + 0.017 * sinD(2 * M + F);
  r += -0.58 * cosD(M - 2 * D) - 0.46 * cosD(2 * D);
  lon = norm360(lon);
  const ecl = 23.4393 - 3.563e-7 * d;
  const xg = r * cosD(lon) * cosD(lat), yg = r * sinD(lon) * cosD(lat), zg = r * sinD(lat);
  const xe = xg, ye = yg * cosD(ecl) - zg * sinD(ecl), ze = yg * sinD(ecl) + zg * cosD(ecl);
  return { ra: norm360(Math.atan2(ye, xe) / RAD), dec: Math.atan2(ze, Math.hypot(xe, ye)) / RAD, r, lon, lat };
}

/** Local sidereal time in degrees. */
function lstDeg(ms: number, lonDeg: number): number {
  const d = (ms - D0_MS) / DAY_MS;
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = 356.047 + 0.9856002585 * d;
  const gmst0 = Ms + ws + 180;
  const utHours = ((ms % DAY_MS) + DAY_MS) % DAY_MS / 3_600_000;
  return norm360(gmst0 + utHours * 15 + lonDeg);
}

function altitudeDeg(eq: Equatorial, ms: number, lat: number, lon: number): number {
  const ha = lstDeg(ms, lon) - eq.ra;
  const s = sinD(lat) * sinD(eq.dec) + cosD(lat) * cosD(eq.dec) * cosD(ha);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/** Geocentric altitude of the Sun / Moon (degrees). */
export const sunAltitude = (ms: number, lat: number, lon: number): number => altitudeDeg(sunPosition(ms), ms, lat, lon);
export const moonAltitude = (ms: number, lat: number, lon: number): number => altitudeDeg(moonPosition(ms), ms, lat, lon);
/** Topocentric moon altitude — the geocentric one less the parallax
 *  (~0.95°); what "30° above the horizon" means to an observer. */
export function moonAltitudeTopo(ms: number, lat: number, lon: number): number {
  const eq = moonPosition(ms);
  const h = altitudeDeg(eq, ms, lat, lon);
  const par = Math.asin(1 / eq.r) / RAD;
  return h - par * cosD(h);
}

export interface MoonPhase { illumPct: number; waxing: boolean; phaseName: string; /** Sun–Moon elongation, degrees 0..360 (0 new, 180 full) */ elongation: number }

/** Illuminated fraction from the Sun–Moon elongation (geocentric). */
export function moonPhase(ms: number): MoonPhase {
  const s = sunPosition(ms), m = moonPosition(ms);
  const elong = norm360(m.lon - s.lon);
  const cosE = cosD(m.lat) * cosD(elong);
  const illum = (1 - cosE) / 2;
  const illumPct = Math.round(illum * 100);
  const waxing = elong < 180;
  let phaseName: string;
  if (illumPct < 3) phaseName = "new moon";
  else if (illumPct > 97) phaseName = "full moon";
  else if (illumPct >= 45 && illumPct <= 55) phaseName = waxing ? "first quarter" : "last quarter";
  else if (illumPct < 45) phaseName = waxing ? "waxing crescent" : "waning crescent";
  else phaseName = waxing ? "waxing gibbous" : "waning gibbous";
  return { illumPct, waxing, phaseName, elongation: elong };
}

export interface Crossing { ms: number; rising: boolean }

/** Every crossing of `altFn(ms) = h0` inside [fromMs, toMs]: a 10-minute
 *  scan for sign changes, then bisection to ~10 s. */
export function crossings(altFn: (ms: number) => number, h0: number, fromMs: number, toMs: number, stepMs = 10 * 60_000): Crossing[] {
  const out: Crossing[] = [];
  let t0 = fromMs, f0 = altFn(t0) - h0;
  while (t0 < toMs) {
    const t1 = Math.min(toMs, t0 + stepMs), f1 = altFn(t1) - h0;
    if ((f0 < 0 && f1 >= 0) || (f0 >= 0 && f1 < 0)) {
      let a = t0, b = t1, fa = f0;
      for (let k = 0; k < 7; k++) {
        const m = (a + b) / 2, fm = altFn(m) - h0;
        if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m;
      }
      out.push({ ms: Math.round((a + b) / 2 / 60_000) * 60_000, rising: f1 >= 0 });
    }
    t0 = t1; f0 = f1;
  }
  return out;
}

export type IllumBand = "lo" | "mid" | "hi";
export interface LunarThresholds { low: number; high: number }
export const DEFAULT_LUNAR_THRESHOLDS: LunarThresholds = { low: 25, high: 60 };
export function illumBand(illumPct: number, t: LunarThresholds = DEFAULT_LUNAR_THRESHOLDS): IllumBand {
  return illumPct < t.low ? "lo" : illumPct >= t.high ? "hi" : "mid";
}
export function sanitizeThresholds(v: unknown): LunarThresholds {
  const o = (v ?? {}) as { low?: unknown; high?: unknown };
  const low = Number(o.low), high = Number(o.high);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 100 || low >= high) return DEFAULT_LUNAR_THRESHOLDS;
  return { low: Math.round(low), high: Math.round(high) };
}

export type Interval = [number, number];

export interface LunarNight {
  /** The local calendar date the night BEGINS on. */
  date: string;
  zone: string;
  /** Instants (ms). null = the event does not occur (polar day / night). */
  sunset: number | null;
  eent: number | null;
  bmnt: number | null;
  sunrise: number | null;
  /** Moonrise / moonset instants between local noon and the next local noon. */
  moonrise: number[];
  moonset: number[];
  illumPct: number;
  waxing: boolean;
  phaseName: string;
  /** Darkness EENT→BMNT in hours; null when the night has no darkness or no end. */
  darkH: number | null;
  moonlitDarkH: number | null;
  usefulMoonH: number | null;
  moonFreeDarkH: number | null;
  /** Moon above the horizon during darkness; moon ≥ MOON_USEFUL_ALT_DEG during darkness. */
  moonUp: Interval[];
  moonHigh: Interval[];
  daylightH: number | null;
  band: IllumBand;
  /** True when the sun never reaches −12° (no nautical darkness) or never rises. */
  polar: boolean;
}

const hours = (ms: number) => Math.round(ms / 360_000) / 10;

/** Intervals inside [a, b] where `altFn ≥ h0`, from a scan at `stepMs`. */
function aboveIntervals(altFn: (ms: number) => number, h0: number, a: number, b: number, stepMs: number): Interval[] {
  const out: Interval[] = [];
  const cs = crossings(altFn, h0, a, b, stepMs);
  let up = altFn(a) >= h0;
  let start = up ? a : null;
  for (const c of cs) {
    if (c.rising && !up) { up = true; start = c.ms; }
    else if (!c.rising && up) { up = false; if (start != null) out.push([start, c.ms]); start = null; }
  }
  if (up && start != null && b > start) out.push([start, b]);
  return out.filter(([s, e]) => e > s);
}

const sumH = (xs: Interval[]) => hours(xs.reduce((n, [s, e]) => n + (e - s), 0));

/** One night at (lat, lon): from local noon on `date` to local noon the next day. */
export function lunarNight(lat: number, lon: number, zone: string, date: string, thresholds: LunarThresholds = DEFAULT_LUNAR_THRESHOLDS): LunarNight {
  const noon = zoneDayStartMs(date, zone) + 12 * 3_600_000;
  const nextMidnight = zoneDayStartMs(addDays(date, 1), zone);
  const nextNoon = nextMidnight + 12 * 3_600_000;
  const sunAlt = (ms: number) => sunAltitude(ms, lat, lon);
  const moonAlt = (ms: number) => moonAltitude(ms, lat, lon);

  const sunCs = crossings(sunAlt, H0_SUN, noon, nextNoon);
  const nautCs = crossings(sunAlt, H0_NAUTICAL, noon, nextNoon);
  const sunset = sunCs.find((c) => !c.rising)?.ms ?? null;
  const sunrise = sunCs.find((c) => c.rising)?.ms ?? null;
  const eent = nautCs.find((c) => !c.rising)?.ms ?? null;
  const bmnt = nautCs.find((c) => c.rising && (eent == null || c.ms > eent))?.ms ?? null;

  const moonCs = crossings(moonAlt, H0_MOON, noon, nextNoon);
  const moonrise = moonCs.filter((c) => c.rising).map((c) => c.ms);
  const moonset = moonCs.filter((c) => !c.rising).map((c) => c.ms);

  const phase = moonPhase(nextMidnight);
  const polar = eent == null || bmnt == null;
  let darkH: number | null = null, moonlitDarkH: number | null = null, usefulMoonH: number | null = null, moonFreeDarkH: number | null = null;
  let moonUp: Interval[] = [], moonHigh: Interval[] = [];
  if (!polar && bmnt! > eent!) {
    moonUp = aboveIntervals(moonAlt, H0_MOON, eent!, bmnt!, 5 * 60_000);
    moonHigh = aboveIntervals((ms) => moonAltitudeTopo(ms, lat, lon), MOON_USEFUL_ALT_DEG, eent!, bmnt!, 5 * 60_000);
    darkH = hours(bmnt! - eent!);
    moonlitDarkH = sumH(moonUp);
    usefulMoonH = sumH(moonHigh);
    moonFreeDarkH = Math.max(0, Math.round((darkH - moonlitDarkH) * 10) / 10);
  }
  // Daylight on the date itself (its sunrise → its sunset), from the day's own window.
  const dayStart = zoneDayStartMs(date, zone);
  const dayCs = crossings(sunAlt, H0_SUN, dayStart, noon);
  const todaySunrise = dayCs.find((c) => c.rising)?.ms ?? null;
  const daylightH = todaySunrise != null && sunset != null ? hours(sunset - todaySunrise) : (sunAlt(noon) > H0_SUN && todaySunrise == null && sunset == null ? 24 : null);

  return {
    date, zone, sunset, eent, bmnt, sunrise, moonrise, moonset,
    illumPct: phase.illumPct, waxing: phase.waxing, phaseName: phase.phaseName,
    darkH, moonlitDarkH, usefulMoonH, moonFreeDarkH, moonUp, moonHigh, daylightH,
    band: illumBand(phase.illumPct, thresholds), polar,
  };
}

export function lunarNights(lat: number, lon: number, zone: string, startDate: string, count: number, thresholds: LunarThresholds = DEFAULT_LUNAR_THRESHOLDS): LunarNight[] {
  const out: LunarNight[] = [];
  for (let i = 0; i < count; i++) out.push(lunarNight(lat, lon, zone, addDays(startDate, i), thresholds));
  return out;
}

export interface LunarWindow {
  band: IllumBand;
  from: string;
  to: string;
  nights: number;
  /** Index of the first night in the input list. */
  startIndex: number;
  /** The best night: most moon-free dark for a LOW window, most moonlit dark for a HIGH one. */
  best: LunarNight;
}

/** Consecutive nights in one band. Polar nights break a window. */
export function lunarWindows(nights: LunarNight[]): LunarWindow[] {
  const out: LunarWindow[] = [];
  let cur: { band: IllumBand; items: LunarNight[]; startIndex: number } | null = null;
  nights.forEach((n, i) => {
    if (n.polar) { cur = null; return; }
    if (cur && cur.band === n.band) cur.items.push(n);
    else { cur = { band: n.band, items: [n], startIndex: i }; }
    if (cur.items.length === 1) out.push({ band: cur.band, from: n.date, to: n.date, nights: 1, startIndex: i, best: n });
    const w = out[out.length - 1];
    w.to = n.date; w.nights = cur.items.length;
    w.best = cur.items.reduce((b, x) => (cur!.band === "lo" ? (x.moonFreeDarkH ?? 0) > (b.moonFreeDarkH ?? 0) : (x.usefulMoonH ?? 0) * x.illumPct > (b.usefulMoonH ?? 0) * b.illumPct) ? x : b);
  });
  return out;
}

/** HHMM in the night's zone. */
export function hhmmIn(ms: number | null, zone: string): string {
  if (ms == null) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)).replace(":", "");
  } catch { return new Date(ms).toISOString().slice(11, 16).replace(":", "") + "Z"; }
}

/** One sentence for the Glance strip / an airfield row. */
export function lunarTonightLine(n: LunarNight): string {
  const pct = `${n.illumPct}% ${n.phaseName}`;
  if (n.polar) return `${pct} · no nautical darkness tonight (polar)`;
  const z = n.zone;
  const dark = `${n.darkH} h dark ${hhmmIn(n.eent, z)}–${hhmmIn(n.bmnt, z)}`;
  if (n.moonUp.length === 0) return `${pct} · ${dark} · moon down all night`;
  const first = n.moonUp[0], last = n.moonUp[n.moonUp.length - 1];
  const risesInDark = first[0] > (n.eent ?? 0), setsInDark = last[1] < (n.bmnt ?? Infinity);
  const when = !risesInDark && !setsInDark ? "moon up all night"
    : risesInDark && !setsInDark ? `moon-free until ${hhmmIn(first[0], z)}`
    : !risesInDark && setsInDark ? `moon-free after ${hhmmIn(last[1], z)}`
    : `moon up ${hhmmIn(first[0], z)}–${hhmmIn(last[1], z)}`;
  return `${pct} · ${dark} · ${when} · ${n.moonlitDarkH} h moonlit (${n.usefulMoonH} h ≥${MOON_USEFUL_ALT_DEG}°) · ${n.moonFreeDarkH} h moon-free`;
}
