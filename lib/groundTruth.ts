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
import { haversineKm, getDisasters } from "./disasters";
import { getCountryHolidays, type UpcomingHoliday } from "./holidays";
import { getAdvisoryDetail, type AdvisoryRiskArea } from "./stateAdvisoryDetail";
import { getHealthEvents } from "./health";
import { getHostNationHealth, type HealthIndicator } from "./whoHealth";
import { scoreConflictNews, type ConflictNewsSignal } from "./conflictNews";
import type { NewsItem, OsintFeed, DisasterEvent } from "./types";

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

// Natural / humanitarian disaster affecting the country (GDACS/USGS/ReliefWeb),
// in-country or within ~500 km of its centroid.
export interface DisasterRow {
  type: string;
  title: string;
  severity: "red" | "orange" | "green" | "unknown";
  date: string;            // ISO
  km: number | null;       // null = in-country name match
  link: string;
}

export interface CountryCivil {
  advisoryLevel: number | null;       // State Dept 1–4 (shown even when calm)
  departure: "ordered" | "authorized" | null;
  advisoryLink?: string;
  events: { label: string; when: string }[]; // observances / national days / elections
  holidays: UpcomingHoliday[];        // host-nation public holidays (Nager.Date)
  // Richer per-country detail scraped from the State destination page when
  // available (lib/stateAdvisoryDetail). Absent → only the RSS level above.
  worstAreaLevel?: number | null;     // worst sub-area level (the "risk bubble")
  indicators?: string[];              // risk-indicator pills ("Terrorism (T)", …)
  guidance?: string;                  // "Reconsider travel to … due to …"
  riskAreas?: AdvisoryRiskArea[];     // per-region Do-Not-Travel / elevated areas
  advisoryIssued?: string;            // "March 13, 2026"
}

// Host-nation health: live WHO outbreaks (DON) + structural WHO GHO indicators.
export interface HostHealth {
  outbreaks: { disease: string; link: string; date: string }[];
  indicators: HealthIndicator[];
}

export interface CountryDossier {
  country: string;
  center: [number, number] | null; // country centroid (for the mini-map)
  incidents: Incident[];
  disasters: DisasterRow[];
  news: NewsItem[];
  // Timeliest kinetic read — the country's recent news scored for active
  // hostilities (the same signal that drives the Force-Protection dot). Surfaced
  // as the dossier's lead "active conflict reporting" banner.
  conflictNews: ConflictNewsSignal;
  civil: CountryCivil;
  health: HostHealth;
}

const NEAR_KM = 500;

const DISASTER_SEV_RANK: Record<DisasterRow["severity"], number> = { red: 0, orange: 1, green: 2, unknown: 3 };

// PURE: disasters affecting a country — in-country (name match) or within ~500 km
// of its centroid. Sorted in-country first, then severity, HADR relevance, and
// proximity. Unit-tested without network.
export function countryDisasters(disasters: DisasterEvent[], country: string, centroid: [number, number] | null): DisasterRow[] {
  const scored: { e: DisasterEvent; km: number | null; inCountry: boolean }[] = [];
  for (const e of disasters) {
    const inCountry = !!e.country && countryMatch(e.country, country);
    const km = e.lat != null && e.lon != null && centroid ? Math.round(haversineKm(centroid[0], centroid[1], e.lat, e.lon)) : null;
    if (!inCountry && !(km != null && km <= NEAR_KM)) continue;
    scored.push({ e, km: inCountry ? null : km, inCountry });
  }
  scored.sort((a, b) =>
    (a.km == null ? 0 : 1) - (b.km == null ? 0 : 1) ||
    DISASTER_SEV_RANK[a.e.severity] - DISASTER_SEV_RANK[b.e.severity] ||
    b.e.hadrScore - a.e.hadrScore ||
    (a.km ?? 0) - (b.km ?? 0),
  );
  return scored.slice(0, 6).map(({ e, km }) => ({
    type: e.type, title: e.title, severity: e.severity, date: e.time, km, link: e.link,
  }));
}

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
  const [acled, conflict, gdelt, osint, advisories, disasterEvents, holidays, detail, healthEvents, hostHealth] = await Promise.all([
    getAcledEvents().catch(() => []),
    getConflictPoints().catch(() => []),
    gdeltLocalNews(country).catch(() => [] as NewsItem[]),
    osintCountryNews(country, osintFeeds).catch(() => [] as NewsItem[]),
    getAllStateAdvisories().catch(() => []),
    getDisasters().catch(() => [] as DisasterEvent[]),
    getCountryHolidays(country).catch(() => [] as UpcomingHoliday[]),
    getAdvisoryDetail(country).catch(() => null),
    getHealthEvents().catch(() => ({ live: false, events: [] as { disease: string; country: string; link: string; pubDate: string }[] })),
    getHostNationHealth(country).catch(() => null),
  ]);

  // Host-nation health: live WHO outbreaks in-country (DON) + structural GHO
  // indicators. Outbreaks matched by loose country name; deduped by disease.
  const seenDisease = new Set<string>();
  const outbreaks = healthEvents.events
    .filter((e) => countryMatch(e.country, country))
    .filter((e) => !seenDisease.has(e.disease.toLowerCase()) && seenDisease.add(e.disease.toLowerCase()))
    .slice(0, 4)
    .map((e) => ({ disease: e.disease, link: e.link, date: e.pubDate }));
  const health: HostHealth = { outbreaks, indicators: hostHealth?.indicators ?? [] };

  // Civil context — the advisory level is shown at every level (1–4), not just
  // the elevated ones the force-protection threat axis flags, so the section is
  // populated even for calm countries. The per-country destination scrape
  // (`detail`) is the richer source when reachable; the RSS (`adv`) is the
  // always-on backstop — we prefer the detail level/link but fall back to RSS.
  const adv = advisories.find((a) => countryMatch(a.country, country));
  const civil: CountryCivil = {
    advisoryLevel: detail?.level ?? adv?.level ?? null,
    departure: adv?.orderedDeparture ? "ordered" : adv?.authorizedDeparture ? "authorized" : null,
    ...((detail?.link ?? adv?.link) ? { advisoryLink: detail?.link ?? adv!.link } : {}),
    events: civilCalendarEvents(country, Date.now()).slice(0, 4).map((e) => ({ label: e.label, when: e.active ? "active" : `in ${e.daysUntil}d` })),
    holidays,
    ...(detail ? {
      worstAreaLevel: detail.worstAreaLevel,
      indicators: detail.indicators,
      ...(detail.guidance ? { guidance: detail.guidance } : {}),
      riskAreas: detail.riskAreas,
      ...(detail.dateIssued ? { advisoryIssued: detail.dateIssued } : {}),
    } : {}),
  };
  const disasters = countryDisasters(disasterEvents, country, cen);

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
    // Prefer the authoritative country field (UCDP gives e.g. "Nigeria",
    // "DR Congo (Zaire)") — c.name is only a town/place, so matching on it alone
    // missed most monitored countries. Fall back to name/title, then proximity.
    const inCountry = (!!c.country && countryMatch(c.country, country)) || countryMatch(c.name, country) || (!!c.title && countryMatch(c.title, country));
    const km = cen ? Math.round(haversineKm(cen[0], cen[1], c.lat, c.lon)) : null;
    if (!inCountry && !(km != null && km <= NEAR_KM)) continue;
    incidents.push({
      src: "ucdp", type: c.title || "Organized violence", location: c.name,
      date: c.date ?? "", fatalities: c.count, lat: c.lat, lon: c.lon, km: inCountry ? null : km, ...(c.url ? { url: c.url } : {}),
    });
  }
  incidents.sort((a, b) =>
    (a.km == null ? 0 : 1) - (b.km == null ? 0 : 1) ||
    b.fatalities - a.fatalities ||
    (a.km ?? 0) - (b.km ?? 0),
  );

  // Merge GDELT + OSINT news: dedupe by link, newest first.
  const seen = new Set<string>();
  const merged = [...gdelt, ...osint]
    .filter((n) => n.link && !seen.has(n.link) && seen.add(n.link))
    .sort((a, b) => Date.parse(b.pubDate || "0") - Date.parse(a.pubDate || "0"));
  // Score the full merged pool for active-conflict signal before slicing for display.
  const conflictNews = scoreConflictNews(merged);
  const news = merged.slice(0, 12);

  return { country, center: cen, incidents: incidents.slice(0, 12), disasters, news, conflictNews, civil, health };
}
