import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { getActiveTrip } from "@/lib/trips";
import { todayInTz } from "@/lib/date";
import { DEFAULT_ZONE } from "@/lib/effectiveZone";
import { isValidTz } from "@/lib/worldClocks";
import { getCurrentConditions, type CurrentConditions } from "@/lib/currentConditions";
import { getFlightCategories, getTafOutlook, type TafOutlook } from "@/lib/aviationWx";
import { fetchLocationHazards } from "@/lib/severeWeather";
import { getTrackingRegistry } from "@/lib/trackingOps";
import type { FlightCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

// Weather where you are — the Glance strip (REVIEW-2026-10 W1). ONE read:
// the effective location by the clocks' own rule (the active TDY trip, else
// home), its conditions now + today, the nearest tracked airfield's flight
// category with the TAF turn and the 30-h model hazard, and home in one
// muted phrase when you are away. Deterministic, from the same keyless
// feeds the Weather tab reads; cached 10 min per user (the trip is per
// user). UNKNOWN is stated, never implied clear: a dead feed leaves the
// field null and `live` says which one.

interface Point { label: string; lat: number; lon: number }
interface Airfield { icao: string; label: string; lat: number; lon: number; own: "hub" | "spoke" | null }

export interface HereWeather {
  here: {
    label: string;
    tdy: { day: number; days: number; endDate: string } | null;
    current: CurrentConditions | null;
  } | null;
  airfield: {
    icao: string;
    label: string;
    km: number;
    cat: FlightCategory;
    taf: TafOutlook | null;
    hazard: { severity: "severe" | "elevated"; flags: string[] } | null;
  } | null;
  home: { label: string; current: CurrentConditions | null; icao: string | null; cat: FlightCategory | null } | null;
  live: { openMeteo: boolean; awc: boolean };
  asOf: string;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { data: HereWeather; expires: number }>();
const NEAR_KM = 300;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearest(p: Point, fields: Airfield[]): (Airfield & { km: number }) | null {
  let best: (Airfield & { km: number }) | null = null;
  for (const f of fields) {
    const km = haversineKm(p.lat, p.lon, f.lat, f.lon);
    if (km <= NEAR_KM && (!best || km < best.km)) best = { ...f, km };
  }
  return best;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  const device = new URL(request.url).searchParams.get("device") ?? "";
  const deviceOk = device && isValidTz(device) ? device : null;

  const key = `${email}|${deviceOk ?? ""}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return NextResponse.json(hit.data);

  const prefs = await getUserPrefs(email).catch(() => null);
  const today = todayInTz(deviceOk ?? prefs?.timezone ?? DEFAULT_ZONE);
  const trip = await getActiveTrip(email, today).catch(() => null);
  const home: Point | null = prefs?.localLat != null && prefs?.localLon != null
    ? { label: prefs.localCity?.trim() || "Home", lat: prefs.localLat, lon: prefs.localLon }
    : null;
  const herePt: Point | null = trip ? { label: trip.label, lat: trip.lat, lon: trip.lon } : home;
  const tripIsHome = !!trip && !!home && Math.abs(trip.lat - home.lat) < 0.1 && Math.abs(trip.lon - home.lon) < 0.1;

  let fields: Airfield[] = [];
  try {
    const reg = await getTrackingRegistry();
    fields = reg.airfields.filter((a) => a.icao && (a.lat || a.lon)).map((a) => ({ icao: a.icao, label: a.label, lat: a.lat, lon: a.lon, own: a.own }));
  } catch { /* no registry → no airfield line */ }
  const nearHere = herePt ? nearest(herePt, fields) : null;
  const nearHome = home && trip && !tripIsHome ? nearest(home, fields) : null;
  const icaos = [nearHere?.icao, nearHome?.icao].filter((x): x is string => !!x);

  const [cur, homeCur, cats, taf, hazards] = await Promise.all([
    herePt ? getCurrentConditions(herePt.lat, herePt.lon) : Promise.resolve(null),
    home && trip && !tripIsHome ? getCurrentConditions(home.lat, home.lon) : Promise.resolve(null),
    icaos.length ? getFlightCategories(icaos) : Promise.resolve({ live: true, byIcao: {} as Record<string, { flightCategory: FlightCategory }> }),
    nearHere ? getTafOutlook([nearHere.icao]).catch(() => ({} as Record<string, TafOutlook>)) : Promise.resolve({} as Record<string, TafOutlook>),
    nearHere ? fetchLocationHazards([{ label: nearHere.icao, lat: nearHere.lat, lon: nearHere.lon }]).catch(() => []) : Promise.resolve([]),
  ]);

  const data: HereWeather = {
    here: herePt ? {
      label: herePt.label,
      tdy: trip ? { day: Math.max(1, dayDiff(trip.startDate, today) + 1), days: Math.max(1, dayDiff(trip.startDate, trip.endDate) + 1), endDate: trip.endDate } : null,
      current: cur,
    } : null,
    airfield: nearHere ? {
      icao: nearHere.icao, label: nearHere.label, km: Math.round(nearHere.km),
      cat: cats.byIcao[nearHere.icao]?.flightCategory ?? "UNKNOWN",
      taf: taf[nearHere.icao] ?? null,
      hazard: hazards[0] ? { severity: hazards[0].severity, flags: hazards[0].flags } : null,
    } : null,
    home: home && trip && !tripIsHome ? {
      label: home.label, current: homeCur,
      icao: nearHome?.icao ?? null,
      cat: nearHome ? cats.byIcao[nearHome.icao]?.flightCategory ?? "UNKNOWN" : null,
    } : null,
    live: { openMeteo: !herePt || cur != null, awc: cats.live },
    asOf: new Date().toISOString(),
  };
  // Only a read with something in it is worth caching; a dead feed retries.
  if (data.here?.current || data.airfield) cache.set(key, { data, expires: Date.now() + TTL_MS });
  return NextResponse.json(data);
}
