// Conflict-zone airspace restrictions — the FAA's KICZ NOTAMs / SFARs (law
// for U.S. operators) and EASA's Conflict Zone Information Bulletins (CZIBs,
// recommendations to EU operators). PURE, client-safe (no fetch, no node:*),
// tested in tests/conflictZones.test.ts.
//
// Every contract here is UNVERIFIED from the build sandbox (faa.gov,
// easa.europa.eu and DAIP are all blocked), so the parsers read TEXT, never
// CSS, and are tolerant; the production diag (`/api/osint/conflict-zones
// ?diag=1`, owner-only) pins them from one paste.
//
// Disciplines:
//   • A level comes from the issuer's own words — "prohibited" (FAA, binding),
//     "should not operate" (EASA, a recommendation), "advisory / exercise
//     caution" — never inferred from a country's reputation.
//   • Placement is said: a FIR the NOTAM names → the FIR's centroid; else a
//     country the text names → the country centroid; else UNPLACED and
//     counted, never drawn at a guess. A centroid is a pin, not the airspace
//     boundary, and the popup says so.
//   • A withdrawn / expired / cancelled entry is dropped, never drawn.

import { firByCode, FIRS } from "./firData";
import { countryCentroid, centroidCountryNames } from "./countryCentroids";
import { titleCaseCountry } from "./countryNames";
import { htmlToText } from "./ukmtoParse";

export type CzSource = "faa" | "easa";
/** prohibited = binding (FAA SFAR / prohibition NOTAM) · avoid = EASA "should
 *  not operate" · caution = advisory / exercise caution · notice = a KICZ
 *  notice whose wording names neither (read the text). */
export type CzLevel = "prohibited" | "avoid" | "caution" | "notice";

export interface CzPoint { lat: number; lon: number; by: "fir" | "country" | "region"; name: string }

export interface ConflictZone {
  id: string;              // "KICZ A0014/22" · "CZIB-2022-01R14"
  source: CzSource;
  level: CzLevel;
  title: string;
  firs: string[];          // ICAO FIR codes the text names
  countries: string[];     // display names
  altitude: string | null; // "all altitudes" · "below FL320" · "FL260 and above"
  issued: string | null;   // yyyy-mm-dd
  validTo: string | null;  // yyyy-mm-dd
  url: string | null;
  text: string;            // ≤ 700 chars, as published
  points: CzPoint[];
}

export const CZ_LEVEL_RANK: Record<CzLevel, number> = { notice: 0, caution: 1, avoid: 2, prohibited: 3 };
export const CZ_LEVEL_LABEL: Record<CzLevel, string> = {
  prohibited: "PROHIBITED", avoid: "SHOULD NOT OPERATE", caution: "CAUTION / ADVISORY", notice: "NOTICE",
};

// ───────────────────────────── shared helpers ─────────────────────────────

/** 4-letter codes that appear in parentheses but are never FIRs. */
const NOT_FIR = new Set(["KICZ", "SFAR", "ICAO", "NOTAM", "FAA", "EASA", "CZIB", "NTSB", "TSA", "ATC", "UTC", "FDC", "USAF"]);

/** FIR codes a text names: a 4-letter code in parentheses or after "FIR"/
 *  "UIR", accepted when the table knows it OR the words before it say FIR /
 *  flight information region. */
export function firCodesIn(text: string): string[] {
  const t = text.toUpperCase();
  const out = new Set<string>();
  const rx = /(?:\(([A-Z]{4})\)|\b(?:FIR|UIR)[\s/:-]+([A-Z]{4})\b|\b([A-Z]{4})\s+(?:FIR|UIR)\b)/g;
  for (const m of t.matchAll(rx)) {
    const code = m[1] ?? m[2] ?? m[3];
    if (!code || NOT_FIR.has(code)) continue;
    const before = t.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0);
    if (firByCode(code) || /\b(FIR|UIR|FLIGHT INFORMATION REGION|UPPER INFORMATION REGION|AIRSPACE)\b/.test(before) || m[2] || m[3]) out.add(code);
  }
  return [...out];
}

/** FIRs named by city ("TEHRAN FIR", "Sana'a FIR") through the table's own
 *  names — in a NOTAM or bulletin only "<city> FIR" / "<city> flight
 *  information region" counts, so a city named in passing places nothing.
 *  `loose` (a short document LABEL such as "KICZ NOTAM A0022/24 - Sanaa
 *  Pointer") accepts the city as a word on its own. */
export function firsByName(text: string, loose = false): string[] {
  const t = text.toUpperCase().replace(/[’'`]/g, "");
  const out: string[] = [];
  for (const f of FIRS) {
    const city = f.name.toUpperCase().replace(/\s+FIR$/, "").trim();
    if (!city) continue;
    const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = loose ? new RegExp(`\\b${esc}\\b`) : new RegExp(`\\b${esc}\\s*(?:\\(?[A-Z]{4}\\)?\\s*)?(FIR|UIR|FLIGHT INFORMATION REGION)\\b`);
    if (rx.test(t)) out.push(f.code);
  }
  return out;
}

/** Bodies of water / regions a bulletin names instead of a country ("Persian
 *  Gulf and Gulf of Oman"). A pin at the region's middle, said as such. */
export const CZ_REGIONS: { name: string; rx: RegExp; lat: number; lon: number }[] = [
  { name: "Persian Gulf", rx: /\b(persian|arabian) gulf\b/i, lat: 26.5, lon: 52.5 },
  { name: "Gulf of Oman", rx: /\bgulf of oman\b/i, lat: 24.5, lon: 58.5 },
  { name: "Red Sea", rx: /\bred sea\b/i, lat: 20.0, lon: 38.5 },
  { name: "Gulf of Aden", rx: /\bgulf of aden\b/i, lat: 12.5, lon: 47.5 },
  { name: "Black Sea", rx: /\bblack sea\b/i, lat: 43.5, lon: 34.0 },
  { name: "Sea of Azov", rx: /\bsea of azov\b/i, lat: 46.0, lon: 36.5 },
  { name: "Eastern Mediterranean", rx: /\beastern mediterranean\b/i, lat: 34.0, lon: 33.5 },
  { name: "Caspian Sea", rx: /\bcaspian sea\b/i, lat: 41.5, lon: 51.0 },
];

/** Regions a text names (display names). */
export function regionsIn(text: string): string[] {
  return CZ_REGIONS.filter((r) => r.rx.test(text)).map((r) => r.name);
}

const COUNTRY_KEYS = centroidCountryNames().filter((k) => k.length >= 4).sort((a, b) => b.length - a.length);

/** Countries a text names, word-bounded, longest first ("Niger" is not in
 *  "Nigeria"), display-cased. */
export function countriesIn(text: string): string[] {
  // A sea named after a country ("Gulf of Oman") is not that country.
  for (const r of CZ_REGIONS) text = text.replace(new RegExp(r.rx.source, "gi"), " ");
  let t = ` ${text.toLowerCase().replace(/[^a-zÀ-ɏ'\s-]/g, " ").replace(/\s+/g, " ")} `;
  const out: string[] = [];
  for (const k of COUNTRY_KEYS) {
    const i = t.indexOf(` ${k} `);
    if (i < 0) continue;
    out.push(titleCaseCountry(k));
    t = t.slice(0, i + 1) + " ".repeat(k.length) + t.slice(i + 1 + k.length); // consume it
  }
  return out;
}

/** "all altitudes" · "below FL320" · "FL260 and above" · "FL260–FL320" · null. */
export function altitudeIn(text: string): string | null {
  const t = text.toUpperCase().replace(/FL\s+(\d{3})/g, "FL$1");
  if (/\bAT ALL (ALTITUDES|FLIGHT LEVELS|LEVELS)\b|\bALL ALTITUDES\b|\bALL FLIGHT LEVELS\b/.test(t)) return "all altitudes";
  const range = t.match(/\b(?:BETWEEN\s+)?(FL\d{3}|SFC|SURFACE)\s*(?:AND|THROUGH|TO|-|–)\s*(FL\d{3})\b/);
  if (range) return `${range[1] === "SURFACE" ? "SFC" : range[1]}–${range[2]}`;
  const below = t.match(/\b(?:BELOW|UNDER|UP TO(?: AND INCLUDING)?)\s+(FL\d{3})\b/);
  if (below) return `below ${below[1]}`;
  const above = t.match(/\b(?:AT AND ABOVE|AT OR ABOVE|ABOVE)\s+(FL\d{3})\b/);
  if (above) return `${above[1]} and above`;
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** dd/mm/yyyy (EASA), yyyy-mm-dd, "16 November 2026", "Nov 16, 2026" → yyyy-mm-dd. */
export function readDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/);
  if (m) { const d = +m[1], mo = +m[2]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[3]}-${pad(mo)}-${pad(d)}`; }
  m = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(20\d{2})\b/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(+m[1])}`;
  m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(+m[2])}`;
  return null;
}

/** Place a zone: FIR centroids first, then country centroids for the
 *  countries no placed FIR serves, then — only when nothing else placed it —
 *  the named sea regions. */
export function placeZone(firs: string[], countries: string[], regions: string[] = []): CzPoint[] {
  const pts: CzPoint[] = [];
  const served = new Set<string>();
  for (const c of firs) {
    const f = firByCode(c);
    if (!f) continue;
    pts.push({ lat: f.lat, lon: f.lon, by: "fir", name: `${f.name} (${f.code})` });
    for (const k of f.countries) served.add(k);
  }
  for (const c of countries) {
    if (served.has(c.toLowerCase())) continue;
    const p = countryCentroid(c);
    if (p) pts.push({ lat: p[0], lon: p[1], by: "country", name: c });
  }
  if (!pts.length) {
    for (const r of regions) {
      const reg = CZ_REGIONS.find((x) => x.name === r);
      if (reg) pts.push({ lat: reg.lat, lon: reg.lon, by: "region", name: reg.name });
    }
  }
  return pts;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ───────────────────────────── FAA KICZ NOTAMs ─────────────────────────────

/** The KICZ NOTAM number in a text ("A0014/22"), or null. */
export function kiczId(text: string): string | null {
  return text.toUpperCase().match(/(?<![A-Z0-9])([A-Z]\d{4})[/_ -](\d{2})(?!\d)/)?.slice(1, 3).join("/") ?? null;
}

/** The level a KICZ text states, in the FAA's own words. */
export function kiczLevel(text: string): CzLevel {
  const t = text.toUpperCase();
  if (/\bPROHIBITED FROM (CONDUCTING|OPERATING|FLIGHT)|\bARE PROHIBITED\b|\bIS PROHIBITED\b|\bPROHIBITS\b|\bPROHIBITION\b/.test(t)) return "prohibited";
  if (/\bADVISORY\b|\bEXERCISE (EXTREME )?CAUTION\b|\bPOTENTIALLY HAZARDOUS\b|\bHAZARDOUS SITUATION\b|\bSHOULD EXERCISE\b/.test(t)) return "caution";
  return "notice";
}

/** The coded lower / upper limits of a NOTAM's Q) line ("Q) KICZ/QRDLP/IV/
 *  NBO/AE/000/259/") — read only when the plain text states no altitude. */
export function qLineAltitude(text: string): string | null {
  const m = text.match(/Q\)\s*(?:[^/\s]*\/){5}(\d{3})\/(\d{3})/i);
  if (!m) return null;
  const lo = Number(m[1]), hi = Number(m[2]);
  if (lo === 0 && hi >= 999) return "all altitudes";
  if (lo === 0) return `SFC–FL${m[2]}`;
  if (hi >= 999) return `FL${m[1]} and above`;
  return `FL${m[1]}–FL${m[2]}`;
}

/** The issuer ("UNITED STATES OF AMERICA PROHIBITION FOR …", "U.S. civil
 *  aviation") is never the place a KICZ document is about. */
const stripIssuer = (s: string) => s.replace(/\bUNITED STATES(?: OF AMERICA)?\b|\bU\.\s?S\.(?=\s|$)|\bUSA\b/gi, " ");

/** One KICZ NOTAM text → a zone, or null for a cancellation (NOTAMC) or a
 *  text with no NOTAM number. */
export function parseKiczNotam(text: string, opts: { url?: string | null; start?: string; end?: string } = {}): ConflictZone | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/\bNOTAMC\b/i.test(t.slice(0, 80))) return null;
  const num = kiczId(t);
  if (!num) return null;
  const firs = [...new Set([...firCodesIn(t), ...firsByName(t)])];
  // The issuer is always the United States ("UNITED STATES OF AMERICA
  // PROHIBITION FOR …") — never the place the NOTAM is about.
  const countries = countriesIn(stripIssuer(t));
  const regions = regionsIn(t);
  const level = kiczLevel(t);
  const altitude = altitudeIn(t) ?? qLineAltitude(t);
  const where = firs.length ? firs.map((c) => firByCode(c)?.name ?? c).join(", ") : countries.join(", ") || "area not named";
  return {
    id: `KICZ ${num}`, source: "faa", level,
    title: `${where} — ${CZ_LEVEL_LABEL[level].toLowerCase()}${altitude ? ` (${altitude})` : ""}`,
    firs, countries, altitude,
    issued: opts.start ? opts.start.slice(0, 10) : null,
    validTo: opts.end ? opts.end.slice(0, 10) : null,
    url: opts.url ?? null,
    text: clip(t, 700),
    points: placeZone(firs, countries, regions),
  };
}

/** The FAA "Prohibitions, Restrictions and Notices" page → one stub per KICZ
 *  document linked (anchor text + href; the page's PDFs carry the NOTAM text,
 *  which the app does not read). Level from the anchor's own words only. */
export function parseFaaRestrictionsPage(html: string, base = "https://www.faa.gov/air_traffic/publications/us_restrictions/"): ConflictZone[] {
  const out = new Map<string, ConflictZone>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const label = htmlToText(m[2]).replace(/\s+/g, " ").trim();
    const hay = `${label} ${decodeURIComponent(href.replace(/\+/g, " "))}`;
    if (!/KICZ/i.test(hay)) continue;
    const num = kiczId(hay.replace(/_/g, "/"));
    if (!num) continue;
    let url: string | null = null;
    try { const u = new URL(href, base); if (u.protocol === "https:" && /(^|\.)faa\.gov$/i.test(u.hostname)) url = u.href; } catch { /* keep null */ }
    const path = decodeURIComponent(href).replace(/[_/-]+/g, " ");
    const firs = [...new Set([...firCodesIn(hay), ...firsByName(label, true)])];
    const countries = countriesIn(stripIssuer(`${label} ${path}`));
    const level: CzLevel = /\bADVISORY\b/i.test(hay) ? "caution" : /\bSFAR\b|PROHIBIT/i.test(hay) ? "prohibited" : "notice";
    const id = `KICZ ${num}`;
    if (out.has(id)) continue;
    out.set(id, {
      id, source: "faa", level, title: label || id, firs, countries, altitude: altitudeIn(label),
      issued: null, validTo: null, url, text: label, points: placeZone(firs, countries, regionsIn(`${label} ${path}`)),
    });
  }
  return [...out.values()];
}

// ───────────────────────────── EASA CZIBs ─────────────────────────────

/** "CZIB-2022-01R14" · "CZIB-2026-03-R5" · "2026-03-R5" → { key "2026-03", rev }. */
export function czibIdIn(s: string): { key: string; rev: number; label: string } | null {
  const m = s.match(/\bCZIB[\s-]*(20\d{2})[\s-](\d{2})(?:[\s-]?R(\d{1,2}))?\b/i) ?? s.match(/\b(20\d{2})-(\d{2})(?:-|\s)?R(\d{1,2})\b/i);
  if (!m) return null;
  const rev = m[3] ? Number(m[3]) : 0;
  return { key: `${m[1]}-${m[2]}`, rev, label: `CZIB-${m[1]}-${m[2]}${rev ? `R${rev}` : ""}` };
}

export type CzibStatus = "active" | "withdrawn" | "expired" | "superseded" | null;

export interface CzibEntry { key: string; rev: number; label: string; title: string; status: CzibStatus; issued: string | null; validTo: string | null; url: string | null; countries: string[]; firs: string[]; regions?: string[] }

const EASA_HOST = /(^|\.)easa\.europa\.eu$/i;

/** The CZIB listing page → one entry per bulletin (highest revision kept).
 *  Text-based: the page is split at each CZIB number; the segment up to the
 *  next number carries its title, dates and status. Links come from anchors
 *  whose href names a CZIB (`…/czibs/czib-2022-01r14`). */
export function parseCzibListing(html: string, base = "https://www.easa.europa.eu/en/domains/air-operations/czibs"): CzibEntry[] {
  const links = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*czib[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const id = czibIdIn(m[1].replace(/czib-?(\d{4})-?(\d{2})-?r(\d+)/i, "CZIB-$1-$2R$3")) ?? czibIdIn(htmlToText(m[2]));
    if (!id) continue;
    try { const u = new URL(m[1], base); if (u.protocol === "https:" && EASA_HOST.test(u.hostname) && !/\.pdf($|\?)/i.test(u.pathname)) links.set(`${id.key}R${id.rev}`, u.href); } catch { /* skip */ }
  }
  const text = htmlToText(html);
  const rx = /\bCZIB[\s-]*20\d{2}[\s-]\d{2}(?:[\s-]?R\d{1,2})?\b|\b20\d{2}-\d{2}(?:-|\s)?R\d{1,2}\b/gi;
  const hits = [...text.matchAll(rx)];
  const best = new Map<string, CzibEntry>();
  for (let i = 0; i < hits.length; i++) {
    const id = czibIdIn(hits[i][0]);
    if (!id) continue;
    const seg = text.slice(hits[i].index!, hits[i + 1]?.index ?? Math.min(text.length, hits[i].index! + 900)).slice(0, 900);
    const after = seg.slice(hits[i][0].length).replace(/^[\s:–—-]+/, "");
    const lines = after.split("\n").map((l) => l.trim()).filter(Boolean);
    // A row rendered on one line ("Active view 01/02/2025 … Airspace of
    // Sudan") keeps its title after the status word, "view" and the dates.
    const tail = (l: string) => l.replace(/^(?:(?:active|withdrawn|revoked|expired|superseded|cancell?ed|view|details)\b|\d{1,2}[/.]\d{1,2}[/.]20\d{2}|20\d{2}-\d{2}-\d{2}|[\s|:–—-])+/i, "").trim();
    const title = (lines.find((l) => /airspace|\bFIR\b|region|territor/i.test(l) && l.length <= 160) ?? lines.find((l) => /[a-z]/i.test(l) && !readDate(l) && l.length <= 160) ?? lines.map(tail).find((l) => /[a-z]{3}/i.test(l) && l.length <= 160) ?? "").replace(/\s+/g, " ");
    const status: CzibStatus = /\bwithdrawn\b|\brevoked\b|\bcancell?ed\b/i.test(seg) ? "withdrawn"
      : /\bsuperseded\b/i.test(seg) ? "superseded"
      : /\bexpired\b/i.test(seg) ? "expired"
      : /\bactive\b|\bvalid\b|\bin force\b/i.test(seg) ? "active" : null;
    const dates = [...seg.matchAll(/\b\d{1,2}[/.]\d{1,2}[/.]20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}\b/g)].map((d) => readDate(d[0])).filter((d): d is string => !!d);
    const validLabel = seg.match(/(?:valid until|validity|valid to|effective until|until)\D{0,20}(\d{1,2}[/.]\d{1,2}[/.]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})/i);
    const issuedLabel = seg.match(/(?:issued|issue date|date of issue|published)\D{0,20}(\d{1,2}[/.]\d{1,2}[/.]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})/i);
    const issued = issuedLabel ? readDate(issuedLabel[1]) : dates[0] ?? null;
    const validTo = validLabel ? readDate(validLabel[1]) : dates.length >= 2 ? [...dates].sort().at(-1)! : null;
    const entry: CzibEntry = {
      key: id.key, rev: id.rev, label: id.label, title, status, issued, validTo,
      url: links.get(`${id.key}R${id.rev}`) ?? [...links.entries()].find(([k]) => k.startsWith(`${id.key}R`))?.[1] ?? null,
      countries: countriesIn(`${title}`), firs: [...new Set([...firCodesIn(title), ...firsByName(title)])], regions: regionsIn(title),
    };
    const prev = best.get(id.key);
    if (!prev || entry.rev > prev.rev || (entry.rev === prev.rev && (entry.title.length > prev.title.length || (!prev.status && entry.status)))) best.set(id.key, entry);
  }
  return [...best.values()];
}

/** One CZIB's own page → what the listing lacks: the FIRs and countries it
 *  names, its altitude, validity, and the recommendation's wording. */
export interface CzibPage { firs: string[]; countries: string[]; regions?: string[]; altitude: string | null; validTo: string | null; issued: string | null; withdrawn: boolean; recommendation: string | null; level: CzLevel | null }
/** The page's own content: <main> (else <article>, else the body) with the
 *  site's menus, header, footer, sidebars and breadcrumbs cut out — read on
 *  the whole page, the navigation names countries (Canada, Brazil…) and FIRs
 *  the bulletin never mentions. */
export function czibMainContent(html: string): string {
  let h = html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ");
  const main = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (main) h = main;
  for (const tag of ["nav", "header", "footer", "aside", "form"]) {
    h = h.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  // Menus and breadcrumbs that are not in a <nav>: a list whose class says so.
  h = h.replace(/<(ul|ol)\b[^>]*class\s*=\s*["'][^"']*\b(menu|breadcrumb|sidebar|navbar|share|social|language)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
  return htmlToText(h).replace(/\s+/g, " ").trim();
}

export function parseCzibPage(html: string): CzibPage {
  const text = czibMainContent(html);
  const valid = text.match(/(?:valid until|validity|valid to|effective until|expiry date)\D{0,25}(\d{1,2}[/.]\d{1,2}[/.]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})/i);
  const issued = text.match(/(?:issued date|issue date|date of issue|issued)\D{0,25}(\d{1,2}[/.]\d{1,2}[/.]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})/i);
  const rec = text.match(/[^.]{0,200}\b(?:should not (?:operate|plan)|not to operate|should exercise caution|operate with caution|recommend(?:s|ed)? (?:that )?operators)[^.]{0,220}\./i)?.[0]?.trim() ?? null;
  const level: CzLevel | null = rec ? (/should not|not to operate/i.test(rec) ? "avoid" : "caution") : null;
  return {
    firs: [...new Set([...firCodesIn(text), ...firsByName(text)])],
    countries: countriesIn(text.slice(0, 6000)),
    regions: regionsIn(text.slice(0, 6000)),
    altitude: altitudeIn(rec ?? text.slice(0, 4000)),
    validTo: valid ? readDate(valid[1]) : null,
    issued: issued ? readDate(issued[1]) : null,
    withdrawn: /\bstatus\b\W{0,5}(withdrawn|revoked|cancell?ed)\b|\bthis czib (?:is|has been) (?:withdrawn|revoked|cancell?ed)\b/i.test(text),
    recommendation: rec ? clip(rec, 400) : null,
    level,
  };
}

/** A listing entry (+ its page when read) → a zone, or null when it is not
 *  in effect: withdrawn / superseded / expired by status, or past its
 *  validity date. With neither a status nor a validity date the entry is
 *  KEPT and the popup says its status was not stated. */
export function czibZone(e: CzibEntry, page: CzibPage | null, todayYmd: string): ConflictZone | null {
  if (e.status === "withdrawn" || e.status === "superseded" || e.status === "expired" || page?.withdrawn) return null;
  const validTo = page?.validTo ?? e.validTo;
  if (validTo && validTo < todayYmd) return null;
  const firs = [...new Set([...(page?.firs ?? []), ...e.firs])];
  const countries = [...new Set([...e.countries, ...(page?.countries ?? [])])];
  const regions = [...new Set([...(e.regions ?? []), ...(page?.regions ?? [])])];
  // EASA's CZIB is a recommendation to EU operators: "should not operate" is
  // AVOID, anything softer is CAUTION. A page not read → the listing alone
  // cannot say which, and a CZIB is issued only for a risk worth naming — avoid
  // is the CZIB's usual wording, so it reads avoid with "recommendation not read".
  const level: CzLevel = page?.level ?? "avoid";
  const altitude = page?.altitude ?? null;
  return {
    id: e.label, source: "easa", level,
    title: e.title || e.label,
    firs, countries, altitude,
    issued: page?.issued ?? e.issued, validTo,
    url: e.url,
    text: clip(page?.recommendation ?? `${e.title}${e.status ? ` · ${e.status}` : " · status not stated on the listing"}${page ? "" : " · recommendation not read (bulletin page not fetched)"}`, 700),
    points: placeZone(firs, countries, regions),
  };
}

/** Merge FAA zones from the two doors by id: the NOTAM text (DAIP) wins over
 *  the page's anchor stub; a stub fills a NOTAM the DAIP read missed. */
export function mergeFaaZones(fromNotams: ConflictZone[], fromPage: ConflictZone[]): ConflictZone[] {
  const out = new Map<string, ConflictZone>();
  for (const z of fromPage) out.set(z.id, z);
  for (const z of fromNotams) {
    const stub = out.get(z.id);
    out.set(z.id, stub && !z.points.length && stub.points.length ? { ...z, firs: stub.firs, countries: stub.countries, points: stub.points, url: z.url ?? stub.url } : { ...z, url: z.url ?? stub?.url ?? null });
  }
  return [...out.values()];
}

/** Worst first, then binding before recommendation, then by id. */
export function sortZones(zs: ConflictZone[]): ConflictZone[] {
  return [...zs].sort((a, b) => CZ_LEVEL_RANK[b.level] - CZ_LEVEL_RANK[a.level] || (a.source === b.source ? 0 : a.source === "faa" ? -1 : 1) || a.id.localeCompare(b.id));
}
