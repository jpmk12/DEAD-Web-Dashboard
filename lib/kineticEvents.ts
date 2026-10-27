// Captured map events as KINETIC EVENTS — PURE, client-safe, tested in
// tests/kineticEvents.test.ts. Dependency-free beyond the pure country
// centroids and the chokepoint phrase helper (the lib/airfields.ts rule).
//
// Why this exists: ACLED's free tier embargoes everything newer than a year,
// UCDP's candidates lag one to two months, and ReliefWeb places a whole
// country at its centroid. The timeliest georeferenced record the app
// holds is the one the user captures in their own browser from a public
// conflict map (LiveUAMap, lib/eventCapture) — and until now it was a feed
// row and a country-room headline, never a POINT. This module reads a
// captured event's title for a kinetic ACT, places it, and hands it to the
// consumers that already join events by distance (the chokepoint reads,
// the country room, the Crisis map's Conflict layer, the I&W conflict
// indicator).
//
// Disciplines:
//   - PHRASES, graded by the shared modality grammar: an op-ed that "could
//     strike" is analysis and earns nothing; a warning is a threat and
//     earns nothing here (the chokepoint grammar tiers threats; a kinetic
//     EVENT is an act or it is not an event).
//   - PLACEMENT IS SAID, NEVER GUESSED. Reported coordinates win. Without
//     them an event is placed at the centroid of the country its title
//     names, else the single country its region page covers, and carries
//     `placement: "country"` so a consumer that needs a real position (the
//     strait joins, the map) can take `reported` only. A multi-country
//     region with no country in the title stays UNPLACED and is dropped —
//     "Explosions reported" on the ISIS page could be Iraq or Syria.
//   - A capture is the user's OWN source. The I&W rule that reads these
//     (lib/warningRules conflictWithCaptures) caps an own-capture-only
//     signal at watching, the same ceiling as a single X post.

import { countryCentroid, centroidCountryNames } from "./countryCentroids";
import { hasPhrase, gradeModality, type GeoEvent } from "./chokepointSignals";
import type { StoredEventDraft } from "./eventCapture";

export type KineticClass = "strike" | "incoming" | "explosion" | "shelling" | "clash" | "drone";
export type Placement = "reported" | "country";

export interface KineticRead { cls: KineticClass; phrase: string }

export interface KineticEvent {
  id: string;
  cls: KineticClass;
  phrase: string;
  title: string;
  url: string;
  lat: number;
  lon: number;
  placement: Placement;
  /** The country the event is placed in (named in the title or by the region page), when known. */
  country: string | null;
  /** The region page label the capture came from ("iran", "isis"…). */
  region: string;
  /** ISO — the event's own time, else the capture time. */
  pubDate: string;
}

// Kinetic ACT phrases per class. Order inside a class is the match order;
// classes are tried in the order below and the FIRST class with a phrase
// wins, so a "drone strike" files as a strike, an intercepted missile as
// incoming, and "explosions heard after airstrikes" as a strike.
const CLASS_PHRASES: [KineticClass, string[]][] = [
  ["strike", [
    "airstrike", "airstrikes", "air strike", "air strikes", "air raid", "air raids", "missile strike", "missile strikes",
    "drone strike", "drone strikes", "struck by", "strikes on", "strike on", "strikes hit", "strike hit", "bombed", "bombing of",
    "targeted by a strike", "was hit by", "were hit by", "hit by a missile", "hit by a drone", "hit by missiles", "hit by drones",
  ]],
  ["incoming", [
    "intercepted", "interception", "interceptions", "sirens sounding", "sirens sound", "sirens activated", "sirens in",
    "missile launched", "missiles launched", "missile fired", "missiles fired", "rocket fire", "rockets fired", "rocket launched",
    "rockets launched", "rocket alert", "missile alert", "incoming fire", "ballistic missile launched", "missiles were fired",
  ]],
  ["explosion", ["explosion", "explosions", "blast", "blasts", "detonated", "detonation", "loud explosions", "explosions heard", "explosions reported"]],
  ["shelling", ["shelling", "shelled", "artillery fire", "artillery strike", "artillery strikes", "mortar fire", "mortar attack", "mortars fired", "artillery shelling"]],
  ["clash", [
    "clashes", "clash between", "clashed with", "gunfire", "firefight", "exchange of fire", "exchanged fire", "ambush", "ambushed",
    "armed attack", "gunmen attacked", "gunmen killed", "attacked a convoy", "attack on a convoy", "attacked a checkpoint",
    "attack on a checkpoint", "killed in an attack", "killed in attack", "fighting between", "heavy fighting",
  ]],
  ["drone", ["drone attack", "drone attacks", "uav attack", "drones attacked", "drone shot down", "drones shot down", "shot down a drone", "shot down drones", "drone was shot down", "drones were shot down", "attack drone", "attack drones", "kamikaze drone", "loitering munition"]],
];

export const KINETIC_LABEL: Record<KineticClass, string> = {
  strike: "strike", incoming: "incoming fire / interception", explosion: "explosion", shelling: "shelling", clash: "armed clash", drone: "drone attack",
};

/** The kinetic ACT a text reports, or null — nothing kinetic, or a threat /
 *  analysis / reversal by the shared modality grammar. */
export function readKinetic(text: string): KineticRead | null {
  if (!text) return null;
  if (gradeModality(text) !== "act") return null;
  for (const [cls, phrases] of CLASS_PHRASES) {
    const phrase = phrases.find((p) => hasPhrase(text, p));
    if (phrase) return { cls, phrase };
  }
  return null;
}

// LiveUAMap region pages → the countries they cover. A page that covers ONE
// country can place a title that names none; a page covering several
// cannot, and the event stays unplaced unless the title names one.
export const REGION_COUNTRIES: Record<string, string[]> = {
  iran: ["Iran"],
  israelpalestine: ["Israel", "Gaza", "West Bank", "Lebanon"],
  israel: ["Israel", "Gaza", "West Bank"],
  syria: ["Syria"],
  yemen: ["Yemen"],
  isis: ["Iraq", "Syria"],
  iraq: ["Iraq"],
  emirates: ["United Arab Emirates"],
  ukraine: ["Ukraine"],
  liveuamap: ["Ukraine"],
  libya: ["Libya"],
  egypt: ["Egypt"],
  lebanon: ["Lebanon"],
  sudan: ["Sudan"],
  venezuela: ["Venezuela"],
  mexico: ["Mexico"],
  korea: ["North Korea", "South Korea"],
  taiwan: ["Taiwan"],
  china: ["China"],
  pakistan: ["Pakistan"],
  afghanistan: ["Afghanistan"],
  india: ["India"],
  somalia: ["Somalia"],
  sahel: ["Mali", "Niger", "Burkina Faso"],
  mali: ["Mali"],
  niger: ["Niger"],
  nigeria: ["Nigeria"],
  ethiopia: ["Ethiopia"],
  myanmar: ["Myanmar"],
  haiti: ["Haiti"],
};

// Country names + a few demonym / capital forms the event titles use, longest
// first so "South Sudan" wins over "Sudan" and "West Bank" over nothing.
const COUNTRY_FORMS: { form: string; country: string }[] = (() => {
  const out: { form: string; country: string }[] = [];
  for (const n of centroidCountryNames()) out.push({ form: n, country: titleCase(n) });
  const extra: [string, string][] = [
    ["iranian", "Iran"], ["tehran", "Iran"], ["isfahan", "Iran"], ["bandar abbas", "Iran"],
    ["israeli", "Israel"], ["tel aviv", "Israel"], ["haifa", "Israel"], ["eilat", "Israel"],
    ["gaza", "Gaza"], ["khan younis", "Gaza"], ["rafah", "Gaza"], ["west bank", "West Bank"], ["jenin", "West Bank"], ["nablus", "West Bank"],
    ["lebanese", "Lebanon"], ["beirut", "Lebanon"], ["hezbollah", "Lebanon"],
    ["syrian", "Syria"], ["damascus", "Syria"], ["aleppo", "Syria"], ["deir ez-zor", "Syria"], ["deir ezzor", "Syria"], ["idlib", "Syria"], ["latakia", "Syria"],
    ["iraqi", "Iraq"], ["baghdad", "Iraq"], ["erbil", "Iraq"], ["kirkuk", "Iraq"], ["mosul", "Iraq"], ["basra", "Iraq"],
    ["yemeni", "Yemen"], ["houthi", "Yemen"], ["houthis", "Yemen"], ["sanaa", "Yemen"], ["hodeidah", "Yemen"], ["aden", "Yemen"],
    ["saudi", "Saudi Arabia"], ["riyadh", "Saudi Arabia"], ["emirati", "United Arab Emirates"], ["abu dhabi", "United Arab Emirates"], ["dubai", "United Arab Emirates"],
    ["kuwaiti", "Kuwait"], ["qatari", "Qatar"], ["doha", "Qatar"], ["bahraini", "Bahrain"], ["jordanian", "Jordan"], ["amman", "Jordan"],
    ["egyptian", "Egypt"], ["cairo", "Egypt"], ["sinai", "Egypt"], ["libyan", "Libya"], ["tripoli", "Libya"], ["benghazi", "Libya"],
    ["ukrainian", "Ukraine"], ["kyiv", "Ukraine"], ["kharkiv", "Ukraine"], ["odesa", "Ukraine"], ["odessa", "Ukraine"], ["zaporizhzhia", "Ukraine"], ["dnipro", "Ukraine"],
    ["russian", "Russia"], ["moscow", "Russia"], ["belgorod", "Russia"], ["crimea", "Ukraine"], ["sevastopol", "Ukraine"],
    ["sudanese", "Sudan"], ["khartoum", "Sudan"], ["somali", "Somalia"], ["mogadishu", "Somalia"], ["pakistani", "Pakistan"], ["karachi", "Pakistan"],
    ["afghan", "Afghanistan"], ["kabul", "Afghanistan"], ["taiwanese", "Taiwan"], ["taipei", "Taiwan"], ["venezuelan", "Venezuela"], ["caracas", "Venezuela"],
    ["north korean", "North Korea"], ["pyongyang", "North Korea"], ["south korean", "South Korea"], ["seoul", "South Korea"],
  ];
  for (const [form, country] of extra) out.push({ form, country });
  return out.sort((a, b) => b.form.length - a.form.length);
})();

function titleCase(s: string): string {
  return s.split(" ").map((w) => (w.length > 2 || w === "dr" ? w[0].toUpperCase() + w.slice(1) : w)).join(" ").replace(/\bOf\b/g, "of").replace(/\bThe\b/g, "the").replace(/\bAnd\b/g, "and");
}

/** The first country a title names (longest form wins), or null. Word-bounded. */
export function countryInTitle(title: string): string | null {
  for (const { form, country } of COUNTRY_FORMS) if (hasPhrase(title, form)) return country;
  return null;
}

/** Where an event is placed: its reported coordinates, else the centroid of
 *  the country its title names, else the single country of its region page;
 *  null when none of those holds. */
export function placeEvent(ev: Pick<StoredEventDraft, "title" | "source" | "lat" | "lon">): { lat: number; lon: number; placement: Placement; country: string | null } | null {
  const region = (ev.source || "").toLowerCase().trim();
  const named = countryInTitle(ev.title);
  const regionCountries = REGION_COUNTRIES[region] ?? (countryCentroid(region) ? [titleCase(region)] : []);
  const country = named ?? (regionCountries.length === 1 ? regionCountries[0] : null);
  if (ev.lat != null && ev.lon != null) return { lat: ev.lat, lon: ev.lon, placement: "reported", country };
  if (!country) return null;
  const c = countryCentroid(country);
  if (!c) return null;
  return { lat: c[0], lon: c[1], placement: "country", country };
}

/** Captured events → placed kinetic events inside the window, newest first. */
export function kineticEvents(events: StoredEventDraft[], nowMs: number, windowDays = 14): KineticEvent[] {
  const cutoff = nowMs - windowDays * 86_400_000;
  const out: KineticEvent[] = [];
  for (const e of events) {
    const read = readKinetic(e.title);
    if (!read) continue;
    const pubDate = e.publishedAt ?? e.capturedAt;
    const t = Date.parse(pubDate);
    if (!Number.isFinite(t) || t < cutoff || t - nowMs > 86_400_000) continue;
    const placed = placeEvent(e);
    if (!placed) continue;
    out.push({ id: e.id, cls: read.cls, phrase: read.phrase, title: e.title, url: e.url, ...placed, region: (e.source || "").toLowerCase(), pubDate: new Date(t).toISOString() });
  }
  return out.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
}

/** The GeoEvent form the chokepoint reads join by distance. `reportedOnly`
 *  (the default) keeps events with a real position — a country centroid
 *  is hundreds of km from any strait and would place every Yemeni event
 *  in the Bab-el-Mandeb approaches. */
export function kineticGeoEvents(events: KineticEvent[], opts: { reportedOnly?: boolean } = {}): GeoEvent[] {
  const reportedOnly = opts.reportedOnly ?? true;
  return events
    .filter((e) => !reportedOnly || e.placement === "reported")
    .map((e) => ({
      id: `cap-${e.id}`, lat: e.lat, lon: e.lon,
      title: e.placement === "country" ? `${e.title} (placed at ${e.country} — no position in the capture)` : e.title,
      date: e.pubDate.slice(0, 10), fatalities: null, source: "LiveUAMap",
    }));
}

export interface Bbox { latMin: number; latMax: number; lonMin: number; lonMax: number }

/** How many placed kinetic events fall inside an AOI: a reported position
 *  inside the bbox, or a country placement whose country the AOI lists. */
export function countKineticInAoi(events: KineticEvent[], aoi: { bbox: Bbox; countries: string[] }): number {
  const names = new Set(aoi.countries.map((c) => c.toLowerCase()));
  let n = 0;
  for (const e of events) {
    if (e.placement === "reported") {
      if (e.lat >= aoi.bbox.latMin && e.lat <= aoi.bbox.latMax && e.lon >= aoi.bbox.lonMin && e.lon <= aoi.bbox.lonMax) n++;
    } else if (e.country && names.has(e.country.toLowerCase())) n++;
  }
  return n;
}

/** Kinetic events in (or placed in) a named country. */
export function kineticInCountry(events: KineticEvent[], country: string): KineticEvent[] {
  const c = country.trim().toLowerCase();
  return events.filter((e) => e.country?.toLowerCase() === c);
}
