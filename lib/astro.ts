// Sun + moon planning data for the SITREP: sunrise/sunset, civil twilight
// (dawn/dusk), moon phase + illumination. PURE math (NOAA solar position
// equations + a standard synodic-phase calculation) — no API, no dependency,
// client-safe, unit-tested. Times are UTC ISO strings; minute precision is
// plenty for planning ("NVG window", "bird watch at dawn"), NOT for precise
// almanac use.

export interface SunTimes {
  sunriseZ: string | null;   // ISO; null = sun never rises/sets that day (polar)
  sunsetZ: string | null;
  civilDawnZ: string | null; // civil twilight begin (sun -6°)
  civilDuskZ: string | null; // civil twilight end
}

export interface MoonInfo {
  illumPct: number;      // 0-100
  phaseName: string;     // "waxing gibbous" etc.
  waxing: boolean;
}

const RAD = Math.PI / 180;

// NOAA sunrise/sunset equation for a given UTC day + zenith angle.
// Returns UTC hours (0-24) or null when the event doesn't occur.
function sunEventUtcHours(dayOfYear: number, year: number, lat: number, lon: number, rising: boolean, zenithDeg: number): number | null {
  const lngHour = lon / 15;
  const t = dayOfYear + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634;
  L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * RAD)) / RAD;
  RA = ((RA % 360) + 360) % 360;
  // quadrant-align RA with L
  RA += (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(L * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(zenithDeg * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD));
  if (cosH > 1 || cosH < -1) return null; // polar day/night for this zenith
  let H = rising ? 360 - Math.acos(cosH) / RAD : Math.acos(cosH) / RAD;
  H /= 15;
  const T = H + RA - 0.06571 * t - 6.622;
  let UT = T - lngHour;
  UT = ((UT % 24) + 24) % 24;
  return UT;
}

function toIso(year: number, month: number, day: number, utcHours: number): string {
  const base = Date.UTC(year, month, day) + utcHours * 3600_000;
  return new Date(Math.round(base / 60000) * 60000).toISOString();
}

// Sun events for the UTC calendar day containing `atMs`.
export function sunTimes(lat: number, lon: number, atMs: number): SunTimes {
  const d = new Date(atMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const start = Date.UTC(year, 0, 1);
  const doy = Math.floor((Date.UTC(year, month, day) - start) / 86400000) + 1;

  const mk = (rising: boolean, zenith: number): string | null => {
    const h = sunEventUtcHours(doy, year, lat, lon, rising, zenith);
    return h === null ? null : toIso(year, month, day, h);
  };
  return {
    sunriseZ: mk(true, 90.833),   // official: 90°50'
    sunsetZ: mk(false, 90.833),
    civilDawnZ: mk(true, 96),     // civil twilight: sun 6° below horizon
    civilDuskZ: mk(false, 96),
  };
}

// Moon phase from the mean synodic month, anchored at the well-known new moon
// of 2000-01-06 18:14 UTC. Good to a few hours — fine for illumination
// planning, not for eclipse math.
const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);

export function moonInfo(atMs: number): MoonInfo {
  const days = (atMs - NEW_MOON_EPOCH_MS) / 86400000;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const frac = age / SYNODIC_DAYS;                       // 0=new, .5=full
  const illum = Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100);
  const waxing = frac < 0.5;
  let phaseName: string;
  if (illum < 3) phaseName = "new moon";
  else if (illum > 97) phaseName = "full moon";
  else if (illum >= 45 && illum <= 55) phaseName = waxing ? "first quarter" : "last quarter";
  else if (illum < 45) phaseName = waxing ? "waxing crescent" : "waning crescent";
  else phaseName = waxing ? "waxing gibbous" : "waning gibbous";
  return { illumPct: illum, phaseName, waxing };
}

export interface AstroData extends SunTimes {
  moon: MoonInfo;
}

export function astroData(lat: number, lon: number, atMs: number): AstroData {
  return { ...sunTimes(lat, lon, atMs), moon: moonInfo(atMs) };
}
