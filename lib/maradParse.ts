// MARAD Maritime Security Communications with Industry (MSCI) advisories —
// PURE, client-safe, tested in tests/maradParse.test.ts. lib/marad.ts fetches.
//
// The U.S. Maritime Administration's advisories are the government's own
// standing statement of threat to commercial shipping in a region ("Red Sea,
// Bab el Mandeb Strait, Gulf of Aden … — Houthi Attacks on Commercial
// Vessels"). That is a DECLARED THREAT by the authority whose job it is to
// declare it — the same standing a UKMTO WARNING has (lib/ukmtoParse
// gradeUkmto) — and it belongs on the chokepoint read beside the wires,
// never as news about a threat. An advisory is never an ACT: MARAD records
// the environment, UKMTO and the wires record the incidents.
//
// The feed is the site's first-party RSS (Drupal taxonomy term 441, RSS 2.0:
// title / link / guid / pubDate, no description). Titles follow
// `YYYY-NNN[a-z]?-<Region>-<Topic>`; the permalink is `/msci/<slug>`.
// An advisory carries a ~6-month auto-expiry, and a reissue "supersedes and
// cancels" the earlier number — so this module keeps the NEWEST advisory
// per region family and drops anything past MAX_AGE_DAYS. Neither the
// expiry nor the superseding line is in the feed (they are on the page), so
// the age cap is the honest proxy and every surface says "as of <date>".

import { gradedRead, hasPhrase, type InterdictionRead, type ChokepointText } from "./chokepointSignals";

export const MARAD_FEED_URL = "https://www.maritime.dot.gov/taxonomy/term/441/feed";
export const MARAD_ADVISORIES_URL = "https://www.maritime.dot.gov/msci-advisories";
/** An advisory older than this is treated as expired (MARAD's own auto-expiry is ~6 months). */
export const MARAD_MAX_AGE_DAYS = 185;

export interface MaradAdvisory {
  /** `2026-013` or `2026-013a` — the advisory's own number. */
  number: string;
  /** The year-and-sequence sort key, from the number. */
  year: number;
  seq: number;
  /** The region clause of the title, verbatim ("Red Sea, Bab el Mandeb Strait, Gulf of Aden"). */
  region: string;
  /** The topic clause of the title, verbatim ("Houthi Attacks on Commercial Vessels"). */
  topic: string;
  title: string;
  url: string;
  /** yyyy-mm-dd from pubDate, or null — never guessed. */
  date: string | null;
  /** Chokepoint ids the region clause names (lib/chokepoints keywords + the
   *  region vocabulary below). Empty for a region no chokepoint covers
   *  (Gulf of Guinea, Caribbean …) — still an advisory, just not on the
   *  strait board. */
  chokepoints: string[];
  /** The graded read — a declared threat whose class comes from the topic. */
  read: InterdictionRead | null;
}

// Only https links on the MSCI path survive — the feed is external content
// rendered as hrefs.
const PERMALINK = /^https:\/\/(www\.)?maritime\.dot\.gov\/msci\/20\d{2}-\d{3}[a-z]?-[a-z0-9-]{3,240}\/?$/i;
const TITLE = /^\s*(20\d{2})-(\d{3})([a-z])?\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+?)\s*$/;

/** Region vocabulary → chokepoint id. Phrase-matched (word-bounded) against
 *  the region clause; several may match ("Red Sea, Bab el Mandeb … Arabian
 *  Sea" → babelmandeb only; "Persian Gulf, Strait of Hormuz, Gulf of Oman"
 *  → hormuz). Kept here, not in lib/chokepoints, because these are MARAD's
 *  own region spellings (no hyphens in "Bab el Mandeb"). */
export const MARAD_REGION_CHOKEPOINTS: { id: string; phrases: string[] }[] = [
  { id: "babelmandeb", phrases: ["red sea", "bab el mandeb", "bab-el-mandeb", "bab al mandeb", "gulf of aden", "southern red sea", "yemen"] },
  { id: "hormuz", phrases: ["strait of hormuz", "hormuz", "persian gulf", "arabian gulf", "gulf of oman"] },
  { id: "suez", phrases: ["suez canal", "suez"] },
  { id: "bosphorus", phrases: ["black sea", "sea of azov", "turkish straits", "bosphorus", "bosporus"] },
  { id: "malacca", phrases: ["strait of malacca", "malacca", "singapore strait", "south china sea"] },
  { id: "taiwan", phrases: ["taiwan strait", "taiwan"] },
  { id: "panama", phrases: ["panama canal", "panama"] },
];

/** Topic vocabulary → interdiction class, first match wins (ordered by
 *  severity). A topic naming nothing interdiction-shaped (a GPS-interference
 *  advisory, a sanctions-compliance notice) grades as null — it is still
 *  listed, it just does not move the strait. */
const TOPIC_CLASS: { cls: InterdictionRead["cls"]; phrases: string[] }[] = [
  { cls: "mining", phrases: ["mine", "mines", "mining", "naval mines", "sea mines"] },
  { cls: "strike", phrases: ["attacks on commercial vessels", "attacks", "attack", "missile", "missiles", "drone", "drones", "uav", "strikes", "hostilities", "armed conflict", "military activity", "military operations"] },
  { cls: "seizure", phrases: ["seizure", "seizures", "boarding", "boardings", "detention", "detentions", "hijacking", "piracy", "armed robbery"] },
  { cls: "closure", phrases: ["closure", "closed", "blockade", "quarantine", "suspension of transits"] },
  { cls: "approach", phrases: ["harassment", "harassing", "interference with vessels", "aggressive", "unsafe"] },
  // The generic standing advisory ("Threats to Commercial Vessels by Iran
  // and its Proxies") names no instrument — it is the earliest-signal class
  // (harassment / interference), as a declared threat: the strait is
  // contested, not struck.
  { cls: "approach", phrases: ["threats to commercial vessels", "threat to commercial vessels", "threats to shipping", "threat to shipping", "threats to vessels", "risk to commercial vessels", "risks to commercial vessels", "risk to shipping", "security threat"] },
];

const ymd = (s: string | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/** Parse one title into number / region / topic. Null when the title does
 *  not follow the `YYYY-NNN-Region-Topic` form (the feed also carries the
 *  odd notice that is not an advisory). */
export function parseMaradTitle(title: string): { number: string; year: number; seq: number; region: string; topic: string } | null {
  const m = TITLE.exec(title.replace(/\s+/g, " "));
  if (!m) return null;
  return { number: `${m[1]}-${m[2]}${m[3] ?? ""}`, year: Number(m[1]), seq: Number(m[2]), region: m[4], topic: m[5] };
}

export function regionChokepoints(region: string): string[] {
  const out: string[] = [];
  for (const r of MARAD_REGION_CHOKEPOINTS) if (r.phrases.some((p) => hasPhrase(region, p))) out.push(r.id);
  return out;
}

/** A MARAD advisory is a DECLARED THREAT by the authority — never an act,
 *  whatever the topic says happened: the act is UKMTO's or the wire's to
 *  report. */
export function gradeMarad(topic: string): InterdictionRead | null {
  for (const tc of TOPIC_CLASS) {
    const p = tc.phrases.find((x) => hasPhrase(topic, x));
    if (p) return gradedRead(tc.cls, "threat", p.toLowerCase());
  }
  return null;
}

export interface MaradFeedItem { title?: string; link?: string; pubDate?: string }

/**
 * Feed items → advisories: titles parsed, permalinks validated, NEWEST
 * advisory kept per region clause (a reissue supersedes — "2026-013a"
 * replaces "2026-013" and a later number for the same region replaces
 * both), anything older than `maxAgeDays` at `today` dropped as expired.
 * Items with an unparseable title or a foreign link are skipped, never
 * guessed.
 */
export function parseMaradItems(items: MaradFeedItem[], today: string, maxAgeDays = MARAD_MAX_AGE_DAYS): MaradAdvisory[] {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const byRegion = new Map<string, MaradAdvisory>();
  for (const it of items) {
    const t = typeof it.title === "string" ? it.title.trim() : "";
    const p = parseMaradTitle(t);
    if (!p) continue;
    const url = typeof it.link === "string" ? it.link.trim() : "";
    if (!PERMALINK.test(url)) continue;
    const date = ymd(it.pubDate);
    if (date && Number.isFinite(todayMs)) {
      const age = (todayMs - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
      if (age > maxAgeDays) continue;
    }
    const adv: MaradAdvisory = {
      ...p, title: t.slice(0, 300), url, date,
      chokepoints: regionChokepoints(p.region),
      read: gradeMarad(p.topic),
    };
    const key = p.region.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const cur = byRegion.get(key);
    if (!cur || adv.year > cur.year || (adv.year === cur.year && (adv.seq > cur.seq || (adv.seq === cur.seq && adv.number > cur.number)))) byRegion.set(key, adv);
  }
  return [...byRegion.values()].sort((a, b) => b.year - a.year || b.seq - a.seq);
}

/** The advisories that name a chokepoint, as pre-graded texts for the
 *  shared read (the UKMTO door's shape). One per advisory; a null read
 *  (a topic naming nothing interdiction-shaped) is left out — it would
 *  earn nothing and the board must not list a row that scored nothing. */
export function maradTextsFor(chokepointId: string, advisories: MaradAdvisory[]): ChokepointText[] {
  const out: ChokepointText[] = [];
  for (const a of advisories) {
    if (!a.read || !a.chokepoints.includes(chokepointId)) continue;
    out.push({
      title: `MARAD ${a.number}: ${a.region} — ${a.topic}`,
      summary: `U.S. Maritime Administration advisory ${a.number} in effect${a.date ? ` (issued ${a.date})` : ""}: ${a.topic}.`,
      link: a.url, source: "MARAD",
      pubDate: a.date ? `${a.date}T12:00:00Z` : undefined,
      read: a.read,
    });
  }
  return out;
}
