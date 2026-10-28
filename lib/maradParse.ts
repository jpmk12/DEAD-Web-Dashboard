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
  /** yyyy-mm-dd the advisory expires, when the PAGE states it; else null. */
  expires?: string | null;
  /** How "in effect" was decided: the page's own expiry, or the age proxy. */
  expirySource?: "page" | "proxy" | null;
}

// Only https links on the MSCI path survive — the feed is external content
// rendered as hrefs.
const PERMALINK = /^https:\/\/(www\.)?maritime\.dot\.gov\/msci\/20\d{2}-\d{3}[a-z]?-[a-z0-9-]{3,240}\/?$/i;
// The reissue suffix is UPPER-case on the live feed ("2026-001A" — the
// 2026-10-26 diag skipped every Hormuz advisory as "title shape" for it).
const TITLE = /^\s*(20\d{2})-(\d{3})([a-zA-Z])?\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+?)\s*$/;

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
  { cls: "strike", phrases: ["attacks on commercial vessels", "attacks", "attack", "missile", "missiles", "drone", "drones", "uav", "strikes", "hostilities", "armed conflict", "military activity", "military operations", "combat operations", "military combat", "combat"] },
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
  return { number: `${m[1]}-${m[2]}${(m[3] ?? "").toUpperCase()}`, year: Number(m[1]), seq: Number(m[2]), region: m[4], topic: m[5] };
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
export interface MaradSkipped { title: string; reason: "title shape" | "foreign link" | "expired" | "superseded" | "cancelled"; /** The evidence — "page: expires 2026-07-01" / "age proxy: issued 2026-01-14, no expiry on the page". */ note?: string }

export function parseMaradItems(items: MaradFeedItem[], today: string, maxAgeDays = MARAD_MAX_AGE_DAYS, skipped?: MaradSkipped[]): MaradAdvisory[] {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const byRegion = new Map<string, MaradAdvisory>();
  const skip = (title: string, reason: MaradSkipped["reason"]) => { skipped?.push({ title: title.slice(0, 160), reason }); };
  for (const it of items) {
    const t = typeof it.title === "string" ? it.title.trim() : "";
    const p = parseMaradTitle(t);
    if (!p) { skip(t, "title shape"); continue; }
    const url = typeof it.link === "string" ? it.link.trim() : "";
    if (!PERMALINK.test(url)) { skip(t, "foreign link"); continue; }
    const date = ymd(it.pubDate);
    if (date && Number.isFinite(todayMs)) {
      const age = (todayMs - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
      if (age > maxAgeDays) { skip(t, "expired"); continue; }
    }
    const adv: MaradAdvisory = {
      ...p, title: t.slice(0, 300), url, date,
      chokepoints: regionChokepoints(p.region),
      read: gradeMarad(p.topic),
    };
    const key = p.region.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const cur = byRegion.get(key);
    if (!cur || adv.year > cur.year || (adv.year === cur.year && (adv.seq > cur.seq || (adv.seq === cur.seq && adv.number > cur.number)))) {
      if (cur) skip(cur.title, "superseded");
      byRegion.set(key, adv);
    } else skip(t, "superseded");
  }
  return [...byRegion.values()].sort((a, b) => b.year - a.year || b.seq - a.seq);
}

/** The advisories that name a chokepoint, as pre-graded texts for the
 *  shared read (the UKMTO door's shape). One per advisory; a null read
 *  (a topic naming nothing interdiction-shaped) is left out — it would
 *  earn nothing and the board must not list a row that scored nothing. */
export function maradTextsFor(chokepointId: string, advisories: MaradAdvisory[]): ChokepointText[] {
  const out: ChokepointText[] = [];
  // One advisory per interdiction class per strait — the NEWEST. MARAD
  // spells one region several ways across reissues ("Persian Gulf" /
  // "Arabian Gulf"), so two standing advisories about the same threat
  // would otherwise count as two declared threats on the strait.
  const seen = new Set<string>();
  const sorted = [...advisories].sort((a, b) => b.year - a.year || b.seq - a.seq || b.number.localeCompare(a.number));
  for (const a of sorted) {
    if (!a.read || !a.chokepoints.includes(chokepointId)) continue;
    if (seen.has(a.read.cls)) continue;
    seen.add(a.read.cls);
    out.push({
      title: `MARAD ${a.number}: ${a.region} — ${a.topic}`,
      summary: `U.S. Maritime Administration advisory ${a.number} in effect${a.date ? ` (issued ${a.date}` : ""}${a.expires ? `${a.date ? ", " : " ("}expires ${a.expires}` : ""}${a.date || a.expires ? ")" : ""}: ${a.topic}.`,
      link: a.url, source: "MARAD",
      pubDate: a.date ? `${a.date}T12:00:00Z` : undefined,
      read: a.read,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The advisory PAGE — the only honest source of "in effect".
//
// The feed's pubDate is the Drupal node's CREATION date, which a reissue
// does not change: 2026-001 was created in January and its "A" reissue —
// the thing that keeps it in effect — left the date alone, so the age
// proxy skipped it as expired (2026-10-26 diag, after the title fix). Every
// MSCI advisory ends with a Cancellation paragraph ("This message will
// automatically expire on 23 March 2027"), a page that is superseded says
// so, and the page carries the issue date. `parseMaradPage` reads those
// from the page TEXT (never CSS); `maradInEffect` decides: the page's
// expiry wins, a stated cancellation wins, and only with neither does the
// age proxy apply — and the surfaces say which. Nothing is guessed: a page
// that gives no date leaves the proxy in charge, stated as such.

export interface MaradPageInfo {
  /** yyyy-mm-dd from "Date Issued" / "Issued:" on the page, or null. */
  issued: string | null;
  /** yyyy-mm-dd from the Cancellation paragraph's expiry, or null. */
  expires: string | null;
  /** The page says THIS advisory has been cancelled / superseded / rescinded
   *  — in the passive voice, or by its labelled "Status:" field. */
  cancelled: boolean;
  /** The page's labelled "Status:" field, lower-cased ("cancelled",
   *  "active", "expired"…), or null when the page has none. */
  status: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// "23 March 2027" · "March 23, 2027" · "March 7th, 2026" (the live page's
// spelling, 2026-10-27 — the ordinal suffix is optional) · "2027-03-23" ·
// "03/23/2027" (US).
const ORD = String.raw`(?:st|nd|rd|th)?`;
const DATE_RX = String.raw`(\d{1,2})${ORD}\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})|([A-Za-z]{3,9})\.?\s+(\d{1,2})${ORD},?\s+(\d{4})|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4})`;
// The page's labelled status field: "Status: Cancelled" / "Status: Active".
const STATUS_RX = /\bstatus\s*:\s*(cancell?ed|superseded|rescinded|withdrawn|expired|active|in effect|current)\b/i;
const EXPIRE_RX = new RegExp(String.raw`\b(?:automatically\s+)?(?:expire|expires|expiring|expiration(?:\s+date)?)\b\s*(?:on|:)?\s*(?:${DATE_RX})`, "gi");
const ISSUED_RX = new RegExp(String.raw`\b(?:date\s+)?issued\s*:?\s*(?:on\s+)?(?:${DATE_RX})`, "i");
// Passive voice only — an active reissue says "This advisory supersedes and
// cancels 2025-012", which is the OPPOSITE statement.
const CANCELLED_RX = /\bthis\s+(?:advisory|message|alert)\s+(?:has\s+been|is|was)\s+(?:cancell?ed|superseded|rescinded|withdrawn)\b/i;

function dateFromMatch(m: RegExpMatchArray, base: number): string | null {
  // The alternation's groups start at `base` (1 when DATE_RX is the whole pattern).
  const g = (i: number) => m[base + i];
  const month = (name: string) => MONTHS[name.toLowerCase().slice(0, 4)] ?? MONTHS[name.toLowerCase().slice(0, 3)];
  let y: number, mo: number | undefined, d: number;
  if (g(0)) { d = Number(g(0)); mo = month(g(1)); y = Number(g(2)); }
  else if (g(3)) { mo = month(g(3)); d = Number(g(4)); y = Number(g(5)); }
  else if (g(6)) { y = Number(g(6)); mo = Number(g(7)); d = Number(g(8)); }
  else if (g(9)) { mo = Number(g(9)); d = Number(g(10)); y = Number(g(11)); }
  else return null;
  if (!mo || mo < 1 || mo > 12 || !d || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Read issue date / expiry / cancellation from an advisory page's TEXT
 *  (run the HTML through `htmlToText` first). The expiry is taken from the
 *  Cancellation paragraph when the page has one (the first expiry after
 *  that heading), else the LAST expiry on the page — the Cancellation
 *  paragraph is the final numbered paragraph of every MSCI advisory. */
export function parseMaradPage(text: string): MaradPageInfo {
  const s = (text || "").replace(/\s+/g, " ").slice(0, 200_000);
  const issuedM = ISSUED_RX.exec(s);
  const issued = issuedM ? dateFromMatch(issuedM, 1) : null;
  let expires: string | null = null;
  const cancelAt = s.search(/\bcancellation\b/i);
  const rx = new RegExp(EXPIRE_RX.source, "gi");
  const hits: { at: number; date: string }[] = [];
  for (let m = rx.exec(s); m; m = rx.exec(s)) { const d = dateFromMatch(m, 1); if (d) hits.push({ at: m.index, date: d }); }
  if (hits.length) {
    const after = cancelAt >= 0 ? hits.find((h) => h.at >= cancelAt) : undefined;
    expires = (after ?? hits[hits.length - 1]).date;
  }
  const statusM = STATUS_RX.exec(s);
  const status = statusM ? statusM[1].toLowerCase() : null;
  const cancelledByStatus = status != null && /^(cancell?ed|superseded|rescinded|withdrawn)$/.test(status);
  return { issued, expires, cancelled: CANCELLED_RX.test(s) || cancelledByStatus, status };
}

/** The page's own sentences around the words that decide "in effect" —
 *  for the production diag, so the Cancellation wording of a page the
 *  sandbox cannot reach can be read and pinned. ±`radius` chars around each
 *  hit, merged when they overlap, capped at `max` excerpts. */
export function maradPageExcerpts(text: string, radius = 160, max = 12): string[] {
  const s = (text || "").replace(/\s+/g, " ");
  const rx = /\b(?:expir\w*|cancel\w*|in effect|supersed\w*|rescind\w*|issued|valid until|remain\w*)\b/gi;
  const spans: [number, number][] = [];
  for (let m = rx.exec(s); m; m = rx.exec(s)) {
    const a = Math.max(0, m.index - radius), b = Math.min(s.length, m.index + m[0].length + radius);
    const last = spans[spans.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else spans.push([a, b]);
    if (spans.length > max * 3) break;
  }
  return spans.slice(0, max).map(([a, b]) => `${a > 0 ? "…" : ""}${s.slice(a, b)}${b < s.length ? "…" : ""}`);
}

export interface MaradEffect {
  keep: boolean;
  reason?: "expired" | "cancelled";
  /** The evidence, for the diag and the chip tooltip. */
  note: string;
  expires: string | null;
  source: "page" | "proxy" | null;
}

/**
 * Is the advisory in effect at `today`? The page's statement wins (a
 * cancellation, then its expiry date); without one the age proxy decides
 * from the feed date, and says so. An advisory with no page AND no feed
 * date is kept — unknown age is not expiry — flagged by its note.
 */
export function maradInEffect(adv: Pick<MaradAdvisory, "date">, info: MaradPageInfo | null, today: string, maxAgeDays = MARAD_MAX_AGE_DAYS): MaradEffect {
  if (info?.cancelled) return { keep: false, reason: "cancelled", note: `page: ${info.status ? `status ${info.status}` : "this advisory has been cancelled or superseded"}`, expires: info.expires, source: "page" };
  if (info?.status === "expired") return { keep: false, reason: "expired", note: "page: status expired", expires: info.expires, source: "page" };
  if (info?.expires) {
    const keep = info.expires >= today;
    return { keep, ...(keep ? {} : { reason: "expired" as const }), note: `page: expires ${info.expires}`, expires: info.expires, source: "page" };
  }
  const issued = info?.issued ?? adv.date;
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!issued || !Number.isFinite(todayMs)) return { keep: true, note: "no date on the page or in the feed — kept, age unknown", expires: null, source: null };
  const age = (todayMs - Date.parse(`${issued}T00:00:00Z`)) / 86_400_000;
  const keep = !(age > maxAgeDays);
  return { keep, ...(keep ? {} : { reason: "expired" as const }), note: `age proxy: issued ${issued}, no expiry on the page${info ? "" : " (page not read)"}`, expires: null, source: "proxy" };
}
