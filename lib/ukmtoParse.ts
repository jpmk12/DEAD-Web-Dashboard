// UKMTO (UK Maritime Trade Operations) recent-incidents — the Royal Navy's
// official incident log for the Gulf, Red Sea, Gulf of Aden and the wider
// Indian Ocean voluntary reporting area. PURE, client-safe, unit-tested; no
// fetch, no DB (lib/ukmto.ts owns the network and the capture store).
//
// Why it matters here: the chokepoint board and the I&W chokepoint indicator
// grade NEWS about the straits and join UCDP/ACLED events by distance. UKMTO
// is the primary source those headlines cite — a seizure in the Gulf of Oman
// is on ukmto.org hours before it is on a wire, with a reference number and
// (usually) a position. A UKMTO entry therefore has the standing of a
// Federal Register document or a MOFCOM notice: a REPORTED ACT by the
// authority whose job it is to record it, wire-grade evidence, never "news
// about" one.
//
// What this module knows about the page (pinned from a verbatim copy of one
// entry, 2026-10-11 — the host is unreachable from the dev sandbox and from
// the fetcher, and a third-party tracker reports that UKMTO blocks automated
// access, so lib/ukmto.ts also accepts a BROWSER CAPTURE of the page):
//
//   163-26 - ADVISORY
//   Incident Date: 10 OCT 2026
//   Incident Time: TBC
//   Source: Military authorities
//   UKMTO have received a report of an incident involving a tanker and
//   military forces in the Gulf of Oman. …
//
// and from UKMTO's own weekly VRA overview tables: positions are degrees and
// minutes with a hemisphere ("26 ° 24'N 056 ° 25'E"), dates are UK
// (dd/mm/yyyy or "10 OCT 2026"), the event column carries ADVISORY / WARNING
// / INCIDENT / ATTACK / SUSPICIOUS APPROACH / HIJACK / BOARDING, and the
// reference is "<n>-<yy>". Everything is parsed from TEXT (tags stripped), so
// a CMS restyle does not break it; what it cannot find it leaves null. A
// position is never guessed — an entry with no position but a NAMED sea
// area is PLACED at that area's centroid and says so (`placement: "area"`),
// the same convention as ReliefWeb situations at a country centroid.

import {
  gradedRead, hasPhrase, isReversal, haversineKm,
  type GeoEvent, type ChokepointText, type InterdictionClass, type InterdictionRead, type Modality,
} from "./chokepointSignals";

export const UKMTO_URL = "https://www.ukmto.org/recent-incidents";

export interface UkmtoIncident {
  /** Stable id, "ukmto-163-26". */
  id: string;
  /** UKMTO reference, "163-26". */
  ref: string;
  /** The page's own label, upper-cased: ADVISORY · WARNING · INCIDENT · ATTACK · SUSPICIOUS APPROACH … */
  label: string;
  /** yyyy-mm-dd, or null — never guessed. */
  date: string | null;
  /** The page's time text ("TBC", "0715 UTC"), or null. */
  time: string | null;
  /** Who reported it to UKMTO ("Military authorities", "Master"), or null. */
  reportedBy: string | null;
  lat: number | null;
  lon: number | null;
  /** `reported` = a position on the page; `area` = placed at a named sea
   *  area / port centroid because the entry carries none; null = unplaced. */
  placement: "reported" | "area" | null;
  /** The sea area or port the text names, when one is recognised. */
  area: string | null;
  /** The description, whitespace-collapsed, capped. */
  text: string;
  url: string;
}

// ───────────────────────────── text helpers ─────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", hellip: "…",
};

/** Tags → text with line breaks where block elements ended. Scripts, styles
 *  and comments are dropped whole. Pure string work, no DOM. */
export function htmlToText(html: string): string {
  if (!html) return "";
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|dt|dd|blockquote|pre|td|th|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    const c = code.toLowerCase();
    if (c[0] === "#") {
      const n = c[1] === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[c] ?? m;
  });
  return s.split("\n").map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim()).filter(Boolean).join("\n");
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function ymd(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  // Reject 31 Feb-style rollovers.
  return new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/** "10 OCT 2026" · "10 October 2026" · "10/10/2026" (UK, day first) ·
 *  "2026-10-10". Anything else → null, never a guess. */
export function parseUkmtoDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    return mon ? ymd(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s);
  if (m) return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// ───────────────────────────── positions ─────────────────────────────

const DMS = /(\d{1,2})\s*(?:°|º|deg|-|\s)\s*(\d{1,2}(?:\.\d+)?)\s*['’′]?\s*([NS])\b[\s,/;]*(\d{1,3})\s*(?:°|º|deg|-|\s)\s*(\d{1,2}(?:\.\d+)?)\s*['’′]?\s*([EW])\b/i;
const DMS_DEG_ONLY = /(\d{1,2}(?:\.\d+)?)\s*(?:°|º)\s*([NS])\b[\s,/;]*(\d{1,3}(?:\.\d+)?)\s*(?:°|º)\s*([EW])\b/i;
const COMPACT = /\b(\d{2})(\d{2})(?:\.\d+)?\s*([NS])\b[\s,/;]*(\d{3})(\d{2})(?:\.\d+)?\s*([EW])\b/i;
const DECIMAL = /\b(-?\d{1,2}\.\d{2,})\s*°?\s*([NS])?[\s,/;]+(-?\d{1,3}\.\d{2,})\s*°?\s*([EW])?\b/;

function finish(lat: number, lon: number): { lat: number; lon: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
}

/** Degrees-minutes with hemisphere in the spellings UKMTO uses ("26°24'N
 *  056°25'E", "26 ° 24'N", "26-24N 056-25E", "2624N 05625E"), degrees-only
 *  ("26.4°N 56.42°E") and a bare decimal pair. Null when nothing parses. */
export function parseUkmtoPosition(text: string): { lat: number; lon: number } | null {
  if (!text) return null;
  let m = DMS.exec(text);
  if (m) {
    const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3].toUpperCase() === "S" ? -1 : 1);
    const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6].toUpperCase() === "W" ? -1 : 1);
    if (Number(m[2]) < 60 && Number(m[5]) < 60) return finish(lat, lon);
  }
  m = COMPACT.exec(text);
  if (m) {
    const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3].toUpperCase() === "S" ? -1 : 1);
    const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6].toUpperCase() === "W" ? -1 : 1);
    if (Number(m[2]) < 60 && Number(m[5]) < 60) return finish(lat, lon);
  }
  m = DMS_DEG_ONLY.exec(text);
  if (m) {
    const lat = Number(m[1]) * (m[2].toUpperCase() === "S" ? -1 : 1);
    const lon = Number(m[3]) * (m[4].toUpperCase() === "W" ? -1 : 1);
    return finish(lat, lon);
  }
  m = DECIMAL.exec(text);
  if (m) {
    const lat = Number(m[1]) * (m[2]?.toUpperCase() === "S" ? -1 : 1);
    const lon = Number(m[3]) * (m[4]?.toUpperCase() === "W" ? -1 : 1);
    return finish(lat, lon);
  }
  return null;
}

// ───────────────────────────── sea areas ─────────────────────────────

/** Named waters and ports UKMTO entries place themselves in. Centroids are
 *  planning-grade (the board joins by a 120–600 km radius); longer, more
 *  specific names first so "Gulf of Oman" is not read as "Oman". */
export const SEA_AREAS: { name: string; aliases: string[]; lat: number; lon: number }[] = [
  { name: "Strait of Hormuz", aliases: ["strait of hormuz", "straits of hormuz", "hormuz"], lat: 26.57, lon: 56.25 },
  { name: "Gulf of Oman", aliases: ["gulf of oman"], lat: 24.8, lon: 58.0 },
  { name: "Arabian Gulf", aliases: ["arabian gulf", "persian gulf"], lat: 26.6, lon: 51.8 },
  { name: "Bab el Mandeb", aliases: ["bab el mandeb", "bab-el-mandeb", "bab al mandab", "bab al-mandab", "bab-al-mandab", "bab el-mandeb", "bam"], lat: 12.58, lon: 43.33 },
  { name: "Gulf of Aden", aliases: ["gulf of aden"], lat: 12.5, lon: 47.0 },
  { name: "Southern Red Sea", aliases: ["southern red sea", "south red sea"], lat: 14.5, lon: 42.0 },
  { name: "Red Sea", aliases: ["red sea"], lat: 18.5, lon: 39.5 },
  { name: "Arabian Sea", aliases: ["arabian sea"], lat: 16.0, lon: 62.0 },
  { name: "Somali Basin", aliases: ["somali basin", "somali coast", "off somalia"], lat: 5.0, lon: 50.5 },
  { name: "Gulf of Guinea", aliases: ["gulf of guinea"], lat: 3.5, lon: 4.5 },
  { name: "Singapore Strait", aliases: ["singapore strait", "singapore straits", "strait of singapore", "malacca strait", "strait of malacca"], lat: 1.2, lon: 103.9 },
  { name: "Indian Ocean", aliases: ["indian ocean"], lat: 5.0, lon: 65.0 },
  { name: "Black Sea", aliases: ["black sea"], lat: 43.5, lon: 34.0 },
  { name: "Eastern Mediterranean", aliases: ["eastern mediterranean", "east mediterranean"], lat: 33.5, lon: 31.0 },
  { name: "Mediterranean", aliases: ["mediterranean"], lat: 35.0, lon: 18.0 },
  // Ports and reference points UKMTO entries use ("… NM east of Fujairah").
  { name: "Fujairah", aliases: ["fujairah", "fujaira"], lat: 25.12, lon: 56.36 },
  { name: "Khor Fakkan", aliases: ["khor fakkan", "khorfakkan"], lat: 25.35, lon: 56.37 },
  { name: "Jebel Ali", aliases: ["jebel ali"], lat: 25.0, lon: 55.06 },
  { name: "Bandar Abbas", aliases: ["bandar abbas"], lat: 27.18, lon: 56.27 },
  { name: "Bushehr", aliases: ["bushehr"], lat: 28.97, lon: 50.84 },
  { name: "Basrah", aliases: ["basrah", "basra", "umm qasr", "khor al zubair", "khawr al zubair"], lat: 29.7, lon: 48.5 },
  { name: "Muscat", aliases: ["muscat"], lat: 23.6, lon: 58.6 },
  { name: "Sohar", aliases: ["sohar"], lat: 24.5, lon: 56.7 },
  { name: "Salalah", aliases: ["salalah"], lat: 16.95, lon: 54.0 },
  { name: "Aden", aliases: ["port of aden", "off aden", "aden,"], lat: 12.78, lon: 45.03 },
  { name: "Mukalla", aliases: ["mukalla"], lat: 14.53, lon: 49.13 },
  { name: "Nishtun", aliases: ["nishtun"], lat: 15.82, lon: 52.2 },
  { name: "Hodeidah", aliases: ["hodeidah", "hudaydah", "al hudaydah"], lat: 14.8, lon: 42.95 },
  { name: "Mocha", aliases: ["mocha", "mokha"], lat: 13.32, lon: 43.25 },
  { name: "Eilat", aliases: ["eilat"], lat: 29.55, lon: 34.95 },
  { name: "Jeddah", aliases: ["jeddah"], lat: 21.5, lon: 39.17 },
  { name: "Yanbu", aliases: ["yanbu"], lat: 24.09, lon: 38.06 },
  { name: "Port Sudan", aliases: ["port sudan"], lat: 19.6, lon: 37.22 },
  { name: "Massawa", aliases: ["massawa"], lat: 15.6, lon: 39.45 },
  { name: "Djibouti", aliases: ["djibouti"], lat: 11.6, lon: 43.15 },
  { name: "Bosaso", aliases: ["bosaso", "bossaso"], lat: 11.28, lon: 49.18 },
  { name: "Mogadishu", aliases: ["mogadishu"], lat: 2.05, lon: 45.35 },
];

/** The first named water or port in the text, longest alias first. */
export function seaAreaIn(text: string): { name: string; lat: number; lon: number } | null {
  if (!text) return null;
  let best: { name: string; lat: number; lon: number; len: number; at: number } | null = null;
  const low = text.toLowerCase();
  for (const a of SEA_AREAS) {
    for (const al of a.aliases) {
      const at = low.indexOf(al);
      if (at < 0 || !hasPhrase(text, al)) continue;
      // Prefer the alias that appears first in the text; an alias that
      // starts inside another's span ("Gulf of Oman" inside "the Gulf of
      // Oman") never wins over the longer one; ties → longer.
      const overlaps = best && at > best.at && at < best.at + best.len;
      const covers = best && best.at > at && best.at < at + al.length;
      if (!best || covers || (at < best.at && !overlaps) || (at === best.at && al.length > best.len)) best = { name: a.name, lat: a.lat, lon: a.lon, len: al.length, at };
    }
  }
  return best ? { name: best.name, lat: best.lat, lon: best.lon } : null;
}

// ───────────────────────────── the entries ─────────────────────────────

const MAX_TEXT = 1200;
const MAX_ENTRIES = 300;

// An entry starts with its reference and label: "163-26 - ADVISORY",
// "142 - 26 ATTACK", "UKMTO 103-26: SUSPICIOUS APPROACH". The label runs to
// the first field keyword or line end.
const HEADER = /(?:^|\n|\s)(?:UKMTO\s*)?(\d{1,4})\s*-\s*(\d{2})\s*(?:[-–—:|]\s*)?([A-Z][A-Z][A-Z /&-]{1,40}?)(?=\s*(?:\n|Incident\s+Date|Date\s+of|Date:|Position|Time|Source|Vessel|$))/g;
const FIELD = /^(Incident\s+Date|Date\s+of\s+Incident|Date|Incident\s+Time|Time\s+of\s+Incident|Time|Source|Reported\s+by|Position|Incident\s+Position|Location|Vessel\s+Type|Vessel|Type|Status|Category|Incident\s+Type)\s*:?\s*/i;

function takeField(block: string, names: RegExp): string | null {
  const m = names.exec(block);
  if (!m) return null;
  let v = block.slice(m.index + m[0].length);
  // A field value ends at the next field, a line break, or (tags stripped
  // flat) the narrative's "UKMTO have received…" opener.
  const end = v.search(/\n|(?=\b(?:Incident\s+Date|Incident\s+Time|Date\s+of|Source|Reported\s+by|Position|Incident\s+Position|Location|Vessel|Status|Category|Incident\s+Type)\s*:)|(?=\s+UKMTO\s)|(?=\.\s)/i);
  if (end >= 0) v = v.slice(0, end);
  v = v.replace(/\s+/g, " ").trim().replace(/[,;]$/, "");
  return v.length ? v.slice(0, 80) : null;
}

/** Parse the recent-incidents page (or any UKMTO text carrying entries) into
 *  incidents, newest first as the page lists them. Entries with no
 *  reference are not entries. Deduped by reference. */
export function parseUkmtoText(text: string, url = UKMTO_URL): UkmtoIncident[] {
  if (!text) return [];
  const t = text.replace(/\r/g, "");
  const heads: { ref: string; label: string; start: number; bodyStart: number }[] = [];
  HEADER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADER.exec(t))) {
    const label = m[3].replace(/\s+/g, " ").trim().replace(/[-–—:|]+$/, "").trim();
    if (!label || /^(NM|UTC|LT)$/.test(label)) continue;            // "60 NM" / "23-45 UTC" are not references
    heads.push({ ref: `${Number(m[1])}-${m[2]}`, label: label.toUpperCase(), start: m.index, bodyStart: m.index + m[0].length });
    if (heads.length > MAX_ENTRIES * 2) break;
  }
  const out: UkmtoIncident[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (seen.has(h.ref)) continue;
    const block = t.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : undefined).trim();
    const date = parseUkmtoDate(takeField(block, /(?:Incident\s+Date|Date\s+of\s+Incident|\bDate)\s*:?\s*/i));
    const time = takeField(block, /(?:Incident\s+Time|Time\s+of\s+Incident|\bTime)\s*:?\s*/i);
    const reportedBy = takeField(block, /(?:\bSource|Reported\s+by)\s*:?\s*/i);
    const posField = takeField(block, /(?:Incident\s+Position|\bPosition|\bLocation)\s*:?\s*/i);
    const pos = parseUkmtoPosition(posField ?? "") ?? parseUkmtoPosition(block);
    // The narrative: the block with the labelled fields removed.
    const body = block
      .split("\n")
      .map((l) => (FIELD.test(l) && l.length < 90 ? "" : l))
      .join(" ")
      .replace(/\b(?:Incident\s+Date|Incident\s+Time|Date\s+of\s+Incident|Source|Reported\s+by|Incident\s+Position|Position)\s*:\s*[^.]{0,40}?(?=\s+UKMTO\b|\s+[A-Z][a-z]+\s)/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    const area = seaAreaIn(body);
    const placement: UkmtoIncident["placement"] = pos ? "reported" : area ? "area" : null;
    seen.add(h.ref);
    out.push({
      id: `ukmto-${h.ref}`,
      ref: h.ref,
      label: h.label.slice(0, 40),
      date, time, reportedBy,
      lat: pos?.lat ?? area?.lat ?? null,
      lon: pos?.lon ?? area?.lon ?? null,
      placement,
      area: area?.name ?? null,
      text: body,
      url,
    });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export function parseUkmtoHtml(html: string, url = UKMTO_URL): UkmtoIncident[] {
  return parseUkmtoText(htmlToText(html), url);
}

// ───────────────────────────── grading ─────────────────────────────

// UKMTO's own labels, and the vocabulary of its narratives. Single words are
// acceptable HERE and nowhere else in the app: this corpus is official
// incident descriptions, where every "attack" is an attack — the phrase-only
// rule guards against newsletters, and no newsletter is on this page.
const LABEL_CLASS: { rx: RegExp; cls: InterdictionClass }[] = [
  { rx: /\b(ATTACK|EXPLOSION|FIRED|STRIKE|PROJECTILE|UAV|DRONE|MISSILE)\b/, cls: "strike" },
  { rx: /\b(HIJACK\w*|SEIZ\w*|BOARD\w*|DETAIN\w*|DETENTION|KIDNAP\w*|CAPTURE\w*)\b/, cls: "seizure" },
  { rx: /\bMIN(E|ES|ING)\b/, cls: "mining" },
  { rx: /\b(SUSPICIOUS|APPROACH\w*|HARASS\w*|THEFT|ROBBERY|PIRACY|ARMED)\b/, cls: "approach" },
  { rx: /\b(CLOSURE|CLOSED)\b/, cls: "closure" },
];
const TEXT_CLASS: { cls: InterdictionClass; words: string[] }[] = [
  { cls: "mining", words: ["sea mine", "sea mines", "naval mine", "naval mines", "mine was", "mines were", "limpet"] },
  { cls: "strike", words: ["attacked", "attack", "struck", "projectile", "projectiles", "explosion", "explosions", "fired upon", "came under fire", "missile", "missiles", "drone", "drones", "uav", "uavs", "gunfire", "shots were fired", "rpg", "rocket", "rockets", "set on fire", "on fire", "impact", "impacted", "hit by"] },
  { cls: "seizure", words: ["boarded", "boarding", "hijacked", "hijack", "seized", "seizure", "detained", "detention", "captured", "taken to", "diverted to", "escorted to", "ordered to"] },
  { cls: "closure", words: ["closed to", "closure of", "suspended transits", "halted transits"] },
  { cls: "approach", words: ["suspicious approach", "approached", "approach", "small craft", "skiff", "skiffs", "military forces", "naval forces", "naval vessel", "military activity", "naval activity", "harassed", "harassment", "shadowed", "aggressive", "attempted to board", "persons on board", "unknown craft", "unlit craft"] },
];

/** Grade one incident with the official-record standing: a labelled
 *  incident is an ACT; a WARNING (an increased-threat notice) is a declared
 *  THREAT; a release is a REVERSAL; a label that names nothing interdiction-
 *  shaped and a narrative that names nothing either → null (the incident
 *  still counts as a georeferenced event). */
export function gradeUkmto(inc: Pick<UkmtoIncident, "label" | "text">): InterdictionRead | null {
  const label = (inc.label ?? "").toUpperCase();
  const text = inc.text ?? "";
  if (isReversal(text) || /\bRELEASE/.test(label)) return gradedRead("seizure", "reversal", label.includes("RELEASE") ? label : "release reported");
  let cls: InterdictionClass | null = null;
  let phrase = "";
  for (const lc of LABEL_CLASS) {
    const m = lc.rx.exec(label);
    if (m) { cls = lc.cls; phrase = m[1]; break; }
  }
  if (!cls) {
    for (const tc of TEXT_CLASS) {
      const w = tc.words.find((x) => hasPhrase(text, x));
      if (w) { cls = tc.cls; phrase = w; break; }
    }
  }
  if (!cls) return null;
  const modality: Modality = /\bWARNING\b/.test(label) && !/\b(ATTACK|HIJACK|BOARD|SEIZ)/.test(label) ? "threat" : "act";
  return gradedRead(cls, modality, phrase.toLowerCase());
}

// ───────────────────────────── for the chokepoint read ─────────────────────────────

function titleOf(inc: UkmtoIncident): string {
  const head = `UKMTO ${inc.ref} ${inc.label}`;
  const body = inc.text.length > 140 ? `${inc.text.slice(0, 137).trimEnd()}…` : inc.text;
  return body ? `${head}: ${body}` : head;
}

/** Placed incidents as georeferenced events for `readActivity`. An area-
 *  placed row says so in its title — the reader must see that the dot is a
 *  centroid, not a fix. */
export function ukmtoGeoEvents(incidents: UkmtoIncident[]): GeoEvent[] {
  const out: GeoEvent[] = [];
  for (const inc of incidents) {
    if (inc.lat == null || inc.lon == null) continue;
    out.push({
      id: inc.id, lat: inc.lat, lon: inc.lon,
      title: inc.placement === "area" ? `${titleOf(inc)} (placed at ${inc.area} — no position in the report)` : titleOf(inc),
      date: inc.date ?? undefined,
      fatalities: null,
      source: "UKMTO",
    });
  }
  return out;
}

/** Incidents relevant to one chokepoint: inside its radius when placed,
 *  else naming it. Returned as pre-graded texts so the shared read treats
 *  the official record as what it is. */
export function ukmtoTextsFor(
  point: { lat: number; lon: number; radiusKm?: number; keywords?: string[] },
  incidents: UkmtoIncident[],
  radiusKm = 300,
): ChokepointText[] {
  const r = point.radiusKm ?? radiusKm;
  const out: ChokepointText[] = [];
  for (const inc of incidents) {
    let near = false;
    if (inc.lat != null && inc.lon != null) near = haversineKm(point.lat, point.lon, inc.lat, inc.lon) <= r;
    else if (point.keywords?.length) near = point.keywords.some((k) => hasPhrase(inc.text, k));
    if (!near) continue;
    const read = gradeUkmto(inc);
    if (!read) continue;
    out.push({
      title: titleOf(inc), summary: inc.text, link: inc.url, source: "UKMTO",
      pubDate: inc.date ? `${inc.date}T12:00:00Z` : undefined,
      read,
    });
  }
  return out;
}

// ───────────────────────────── browser capture ─────────────────────────────

export const UKMTO_HOST_ALLOW = [/(^|\.)ukmto\.org$/i];
const MAX_CAPTURE_TEXT = 400_000;

export type ParseUkmtoCaptureResult =
  | { ok: true; incidents: UkmtoIncident[]; host: string; pageUrl: string }
  | { ok: false; error: string };

/** Validate a `dead-ukmto` capture (the extension's page text) and parse it.
 *  The host must be UKMTO's own — a crafted file cannot put an incident in
 *  UKMTO's mouth — and the text is capped before parsing. */
export function parseUkmtoCapture(raw: string): ParseUkmtoCaptureResult {
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return { ok: false, error: "Invalid JSON." }; }
  if (j.format !== "dead-ukmto") return { ok: false, error: "Not a dead-ukmto capture." };
  const src = j.source as { host?: unknown; pageUrl?: unknown } | undefined;
  const host = (typeof src?.host === "string" ? src.host : "").trim().toLowerCase().slice(0, 120);
  if (!host || !UKMTO_HOST_ALLOW.some((rx) => rx.test(host))) return { ok: false, error: "Unsupported source host." };
  let pageUrl = UKMTO_URL;
  try {
    const u = new URL(typeof src?.pageUrl === "string" ? src.pageUrl : "");
    if (u.protocol === "https:" && UKMTO_HOST_ALLOW.some((rx) => rx.test(u.hostname))) pageUrl = u.href.slice(0, 300);
  } catch { /* keep the default */ }
  const parts: string[] = [];
  if (typeof j.text === "string") parts.push(j.text);
  if (Array.isArray(j.blocks)) for (const b of j.blocks) if (typeof b === "string") parts.push(b);
  const text = parts.join("\n\n").slice(0, MAX_CAPTURE_TEXT);
  if (!text.trim()) return { ok: false, error: "No page text in the capture." };
  const incidents = parseUkmtoText(text, pageUrl);
  if (!incidents.length) return { ok: false, error: "No UKMTO entries found in the capture (expected “<n>-<yy> - LABEL” headers)." };
  return { ok: true, incidents, host, pageUrl };
}

/** Newest first by incident date, undated last, then by reference number
 *  descending (the page's own order). */
export function sortUkmto(list: UkmtoIncident[]): UkmtoIncident[] {
  const n = (ref: string) => { const m = /^(\d+)-(\d+)$/.exec(ref); return m ? Number(m[2]) * 10000 + Number(m[1]) : 0; };
  return [...list].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || n(b.ref) - n(a.ref));
}

/** Merge two incident lists by reference, a row with a position or a date
 *  winning over one without (the capture may see fields the fetch did not). */
export function mergeUkmto(a: UkmtoIncident[], b: UkmtoIncident[]): UkmtoIncident[] {
  const m = new Map<string, UkmtoIncident>();
  for (const inc of [...a, ...b]) {
    const prev = m.get(inc.ref);
    if (!prev) { m.set(inc.ref, inc); continue; }
    m.set(inc.ref, {
      ...prev,
      date: prev.date ?? inc.date,
      time: prev.time ?? inc.time,
      reportedBy: prev.reportedBy ?? inc.reportedBy,
      lat: prev.placement === "reported" ? prev.lat : inc.placement === "reported" ? inc.lat : prev.lat ?? inc.lat,
      lon: prev.placement === "reported" ? prev.lon : inc.placement === "reported" ? inc.lon : prev.lon ?? inc.lon,
      placement: prev.placement === "reported" ? "reported" : inc.placement === "reported" ? "reported" : prev.placement ?? inc.placement,
      area: prev.area ?? inc.area,
      text: prev.text.length >= inc.text.length ? prev.text : inc.text,
    });
  }
  return sortUkmto([...m.values()]);
}
