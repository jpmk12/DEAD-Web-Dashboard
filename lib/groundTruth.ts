// "Ground Truth" per-country dossier for the Situation Room tab: the raw local
// detail that the Force Protection posture summarizes — recent security incidents
// (ACLED/UCDP) in-country or nearby, and local news/media (GDELT). Civil/health/
// access for the detail view come from the Force Protection assessment the client
// already holds; this adds the event lists + headlines that aren't in it.

import { getAcledEvents } from "./acled";
import { getConflictPoints } from "./conflictEvents";
import { gdeltLocalNews } from "./localNews";
import { fetchFeed } from "./rss";
import { getAllStateAdvisories } from "./stateAdvisories";
import { civilCalendarEvents } from "./civilCalendar";
import { countryCentroid } from "./countryCentroids";
import { haversineKm } from "./disasters";
import type { NewsItem, OsintFeed } from "./types";

export interface Incident {
  src: "acled" | "ucdp";
  type: string;
  location: string;
  date: string;
  fatalities: number;
  lat: number;
  lon: number;
  km: number | null; // distance from country centroid; null = in-country name match
  url?: string;
}

export interface CountryCivil {
  advisoryLevel: number | null;       // State Dept 1–4 (shown even when calm)
  departure: "ordered" | "authorized" | null;
  advisoryLink?: string;
  events: { label: string; when: string }[]; // observances / national days / elections
}

export interface CountryDossier {
  country: string;
  center: [number, number] | null; // country centroid (for the mini-map)
  incidents: Incident[];
  news: NewsItem[];
  civil: CountryCivil;
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

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Pull the user's OSINT feeds, keep items that mention the country.
async function osintCountryNews(country: string, feeds: OsintFeed[]): Promise<NewsItem[]> {
  if (feeds.length === 0) return [];
  const rx = new RegExp(`\\b${escapeRx(country)}\\b`, "i");
  const results = await Promise.all(
    feeds.slice(0, 8).map((f) => fetchFeed(f.url, f.label, "osint").then((r) => r.items).catch(() => [] as NewsItem[])),
  );
  return results.flat().filter((it) => rx.test(it.title) || rx.test(it.summary ?? "")).slice(0, 8);
}

export async function getCountryDossier(country: string, osintFeeds: OsintFeed[] = []): Promise<CountryDossier> {
  const cen = countryCentroid(country);
  const [acled, conflict, gdelt, osint, advisories] = await Promise.all([
    getAcledEvents().catch(() => []),
    getConflictPoints().catch(() => []),
    gdeltLocalNews(country).catch(() => [] as NewsItem[]),
    osintCountryNews(country, osintFeeds).catch(() => [] as NewsItem[]),
    getAllStateAdvisories().catch(() => []),
  ]);

  // Civil context — the advisory level is shown at every level (1–4), not just
  // the elevated ones the force-protection threat axis flags, so the section is
  // populated even for calm countries.
  const adv = advisories.find((a) => countryMatch(a.country, country));
  const civil: CountryCivil = {
    advisoryLevel: adv?.level ?? null,
    departure: adv?.orderedDeparture ? "ordered" : adv?.authorizedDeparture ? "authorized" : null,
    ...(adv?.link ? { advisoryLink: adv.link } : {}),
    events: civilCalendarEvents(country, Date.now()).slice(0, 4).map((e) => ({ label: e.label, when: e.active ? "active" : `in ${e.daysUntil}d` })),
  };

  const incidents: Incident[] = [];
  for (const e of acled) {
    const inCountry = countryMatch(e.country, country);
    const km = cen ? Math.round(haversineKm(cen[0], cen[1], e.lat, e.lon)) : null;
    if (!inCountry && !(km != null && km <= NEAR_KM)) continue;
    incidents.push({
      src: "acled", type: e.subType || e.type,
      location: [e.location, e.admin1, e.country].filter(Boolean)[0] ?? e.country,
      date: e.date, fatalities: e.fatalities, lat: e.lat, lon: e.lon, km: inCountry ? null : km,
    });
  }
  for (const c of conflict) {
    const inCountry = countryMatch(c.name, country) || (!!c.title && countryMatch(c.title, country));
    const km = cen ? Math.round(haversineKm(cen[0], cen[1], c.lat, c.lon)) : null;
    if (!inCountry && !(km != null && km <= NEAR_KM)) continue;
    incidents.push({
      src: "ucdp", type: c.title || "Organized violence", location: c.name,
      date: "", fatalities: c.count, lat: c.lat, lon: c.lon, km: inCountry ? null : km, ...(c.url ? { url: c.url } : {}),
    });
  }
  incidents.sort((a, b) =>
    (a.km == null ? 0 : 1) - (b.km == null ? 0 : 1) ||
    b.fatalities - a.fatalities ||
    (a.km ?? 0) - (b.km ?? 0),
  );

  // Merge GDELT + OSINT news: dedupe by link, newest first.
  const seen = new Set<string>();
  const news = [...gdelt, ...osint]
    .filter((n) => n.link && !seen.has(n.link) && seen.add(n.link))
    .sort((a, b) => Date.parse(b.pubDate || "0") - Date.parse(a.pubDate || "0"))
    .slice(0, 12);

  return { country, center: cen, incidents: incidents.slice(0, 12), news, civil };
}
