// "Ground Truth" per-country dossier for the Situation Room tab: the raw local
// detail that the Force Protection posture summarizes — recent security incidents
// (ACLED/UCDP) in-country or nearby, and local news/media (GDELT). Civil/health/
// access for the detail view come from the Force Protection assessment the client
// already holds; this adds the event lists + headlines that aren't in it.

import { getAcledEvents } from "./acled";
import { getConflictPoints } from "./conflictEvents";
import { gdeltLocalNews } from "./localNews";
import { countryCentroid } from "./countryCentroids";
import { haversineKm } from "./disasters";
import type { NewsItem } from "./types";

export interface Incident {
  src: "acled" | "ucdp";
  type: string;
  location: string;
  date: string;
  fatalities: number;
  km: number | null; // distance from country centroid; null = in-country name match
  url?: string;
}

export interface CountryDossier {
  country: string;
  incidents: Incident[];
  news: NewsItem[];
}

const NEAR_KM = 500;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(the|of|republic|democratic|peoples?)\b/g, "").trim();
}
function countryMatch(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export async function getCountryDossier(country: string): Promise<CountryDossier> {
  const cen = countryCentroid(country);
  const [acled, conflict, news] = await Promise.all([
    getAcledEvents().catch(() => []),
    getConflictPoints().catch(() => []),
    gdeltLocalNews(country).catch(() => [] as NewsItem[]),
  ]);

  const incidents: Incident[] = [];
  for (const e of acled) {
    const inCountry = countryMatch(e.country, country);
    const km = cen ? Math.round(haversineKm(cen[0], cen[1], e.lat, e.lon)) : null;
    if (!inCountry && !(km != null && km <= NEAR_KM)) continue;
    incidents.push({
      src: "acled", type: e.subType || e.type,
      location: [e.location, e.admin1, e.country].filter(Boolean)[0] ?? e.country,
      date: e.date, fatalities: e.fatalities, km: inCountry ? null : km,
    });
  }
  for (const c of conflict) {
    const inCountry = countryMatch(c.name, country) || (!!c.title && countryMatch(c.title, country));
    const km = cen ? Math.round(haversineKm(cen[0], cen[1], c.lat, c.lon)) : null;
    if (!inCountry && !(km != null && km <= NEAR_KM)) continue;
    incidents.push({
      src: "ucdp", type: c.title || "Organized violence", location: c.name,
      date: "", fatalities: c.count, km: inCountry ? null : km, ...(c.url ? { url: c.url } : {}),
    });
  }
  // In-country first, then deadliest, then nearest.
  incidents.sort((a, b) =>
    (a.km == null ? 0 : 1) - (b.km == null ? 0 : 1) ||
    b.fatalities - a.fatalities ||
    (a.km ?? 0) - (b.km ?? 0),
  );

  return { country, incidents: incidents.slice(0, 12), news: news.slice(0, 10) };
}
