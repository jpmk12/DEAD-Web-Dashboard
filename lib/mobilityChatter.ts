// Mobility CHATTER — tanker and airlift movement reported in the user's own
// sources (X captures, captured articles, newsletters). PURE, client-safe,
// tested in tests/mobilityChatter.test.ts. Dependency-free beyond the pure
// AOR / airfield data (the lib/airfields.ts rule).
//
// The plane-spotting community on X reads the same ADS-B the app's mobility
// sensor reads, but a human aggregates it over a day and NAMES the
// destination ("six KC-135s out of Mildenhall heading east", "4x C-17 on
// the ground at Al Udeid"). That is a demand signal the operator already
// uses by hand; this grammar turns it into rows the board can carry —
// with the single-source discipline every own-source signal has here:
//
//   - PHRASES, with an AIRFRAME gate: "tankers" alone is an oil tanker in
//     Hormuz news; it counts only beside an aviation word (airborne, KC,
//     sortie, refuel, callsign …) and never beside a maritime one (vessel,
//     oil tanker, seized …).
//   - The AOR is the DESTINATION: a named base (the AMC hubs and the fields
//     spotters name), a region phrase, a country. A base after "from / out
//     of / departed" is the ORIGIN and places nothing — "heading east" out
//     of Mildenhall is not a guess at the Gulf.
//   - Direction: TOWARD when a destination is named, AWAY on a return-home
//     phrase, UNCLEAR otherwise. A return wave is an opening, not a demand.
//   - One post is a LEAD. Two distinct handles reporting lift toward the
//     same command inside the window corroborate; corroboration never makes
//     it an observation — the I&W rule (lib/warningRules mobilityWithChatter)
//     caps chatter-only at watching and lets it raise confidence when the
//     ADS-B count agrees.
//   - A COUNT is kept only when the post states one ("6x KC-135", "a dozen
//     tankers"); never inferred.

import type { NewsItem } from "./types";
import { aorFromCoords, aorFromName, type Aor } from "./aor";
import { AMC_HUBS } from "./amcHubs";
import type { PostureMove, ActorSide } from "./postureMoves";

export type AirframeClass = "tanker" | "airlift";
export type ChatterDirection = "toward" | "away" | "unclear";

/** A field the operator tracks (the tracking registry), joined to the
 *  catalogue at read time so a post naming YOUR spoke places — and is
 *  marked `mine`. Built server-side (lib/ownPlaces.ts); the grammar never
 *  reads the registry itself. */
export interface OwnPlace {
  icao: string;
  label: string;
  aor: Aor;
  own: "hub" | "spoke" | null;
  star?: boolean;
}

export interface ChatterPost {
  id: string;
  /** The destination's ICAO when the place carries one (own fields and the AMC hubs), else null. */
  icao: string | null;
  /** The destination is a field the operator tracks (the Global Reach "mine" rule). */
  mine: boolean;
  /** Canonical airframe ids named ("KC-135", "C-17", "tanker"…). */
  airframes: string[];
  classes: AirframeClass[];
  /** A number the post states for the airframes, else null. */
  count: number | null;
  side: ActorSide;
  actor: string;
  /** The destination base / region named, when any. */
  place: string | null;
  /** The origin base named after from / out of / departed, when any. */
  origin: string | null;
  aor: Aor;
  direction: ChatterDirection;
  phrase: string;
  text: string;
  link: string;
  source: string;
  pubDate: string;
}

export interface ChatterCluster {
  id: string;
  aor: Aor;
  side: ActorSide;
  actor: string;
  direction: ChatterDirection;
  reports: number;
  /** Distinct sources (handles / feeds). */
  sources: number;
  corroborated: boolean;
  tankers: number;
  airlifters: number;
  /** The largest count any post stated, else null. */
  count: number | null;
  airframes: string[];
  places: string[];
  /** ICAOs of the destinations named, when known. */
  icaos: string[];
  /** Any report in the cluster names a field the operator tracks. */
  mine: boolean;
  lead: ChatterPost;
  pubDate: string;
}

const DAY = 86_400_000;
export const CHATTER_WINDOW_DAYS = 14;
/** The I&W sensor reads only the last three days of chatter. */
export const CHATTER_SENSOR_HOURS = 72;

interface AirframeDef { id: string; cls: AirframeClass; side: ActorSide; actor: string; rx: RegExp; generic?: boolean }
const US = { side: "us" as ActorSide, actor: "United States" };
const AIRFRAMES: AirframeDef[] = [
  { id: "KC-135", cls: "tanker", ...US, rx: /\bKC-?135[RT]?s?\b|\bstratotankers?\b/i },
  { id: "KC-46", cls: "tanker", ...US, rx: /\bKC-?46[A]?s?\b|\bpegasus tankers?\b/i },
  { id: "KC-10", cls: "tanker", ...US, rx: /\bKC-?10[A]?s?\b/i },
  { id: "KC-130", cls: "tanker", ...US, rx: /\bKC-?130[JT]?s?\b/i },
  { id: "C-17", cls: "airlift", ...US, rx: /\bC-?17[A]?s?\b|\bglobemasters?\b/i },
  { id: "C-5", cls: "airlift", ...US, rx: /\bC-?5[MAB]?s?\b(?!\s*(?:galaxy\s+)?(?:phone|tablet|note))|\bC-5 galaxy\b/i },
  { id: "C-130", cls: "airlift", ...US, rx: /\b(?:[A-Z]{0,2}-?)?C-?130[JH]?s?\b|\bsuper hercules\b/i },
  { id: "REACH", cls: "airlift", ...US, rx: /\b(?:RCH|REACH)\s?\d{2,4}\b/i },
  { id: "A400M", cls: "airlift", side: "ally", actor: "ally", rx: /\bA400M?s?\b|\batlas transports?\b/i },
  { id: "Voyager", cls: "tanker", side: "ally", actor: "ally", rx: /\b(?:RAF|royal air force)\s+voyagers?\b|\bvoyager tankers?\b|\bA330 MRTTs?\b|\bMRTTs?\b/i },
  { id: "Il-76", cls: "airlift", side: "adversary", actor: "Russia", rx: /\bIl-?76s?\b/i },
  { id: "Il-78", cls: "tanker", side: "adversary", actor: "Russia", rx: /\bIl-?78s?\b/i },
  { id: "Y-20", cls: "airlift", side: "adversary", actor: "China", rx: /\bY-?20[AU]?s?\b/i },
  { id: "tanker", cls: "tanker", ...US, generic: true, rx: /\btankers?\b|\btanker (?:track|bridge|drag|cell|package|wave|surge)\b/i },
  { id: "airlifter", cls: "airlift", ...US, generic: true, rx: /\bairlifters?\b|\bairlift (?:wave|surge|flow|bridge)\b|\bair bridge\b/i },
];
// The generic "tanker" counts only beside an aviation word and never beside a maritime one.
const AVIATION_CONTEXT = /\b(?:aircraft|airborne|aerial|refuel\w*|KC-?\d+|sortie|sorties|callsign|callsigns|ADS-?B|flew|flying|flight|flights|took off|take-?off|landed|landing|airfield|air base|AB\b|AFB|RAF|USAF|AMC|squadron|wing|track|drag|bridge|cell|package|orbit|orbiting|transit\w*|en ?route|inbound|outbound|wheels up|boom)\b/i;
const MARITIME_CONTEXT = /\b(?:oil tanker|crude tanker|product tanker|chemical tanker|LNG tanker|vessel|vessels|ship|ships|seized|boarded|hijack\w*|MMSI|dwt|IMO\s?\d|anchorage|strait|port of|aground|cargo ship|merchant)\b/i;

// Movement phrases — one must be present for a post to be chatter at all.
const MOVEMENT = [
  /\bheading (?:east|west|north|south|to|for|toward|towards|out|over|home)\b/i, /\ben ?route\b/i, /\binbound\b/i, /\boutbound\b/i,
  /\blanded\b/i, /\blanding\b/i, /\bdeparted\b/i, /\bdeparting\b/i, /\btook off\b/i, /\btaking off\b/i, /\bwheels up\b/i,
  /\barriv(?:ed|ing|al)\b/i, /\btransit(?:ing|ed|s)?\b/i, /\bcrossing the\b/i, /\bover the (?:atlantic|pacific|med|mediterranean|north sea|gulf)\b/i,
  /\bstaging\b/i, /\bstaged\b/i, /\bdeploy(?:ed|ing|s)?\b/i, /\bforward[- ]deploy/i, /\bon the ground at\b/i, /\bon the ramp at\b/i,
  /\bspotted (?:at|over|near|leaving|departing)\b/i, /\btracking\b/i, /\bairborne\b/i, /\blaunched from\b/i, /\btanker (?:track|bridge|drag|cell|package|wave|surge)\b/i,
  /\bair bridge\b/i, /\bfighter drag\b/i, /\bcoronet\b/i, /\bsortie[sd]?\b/i, /\bflew\b/i, /\bflying\b/i, /\bflight line\b/i, /\bwave of\b/i, /\bstream of\b/i, /\bsurge\b/i,
  /\bback (?:to|home)\b/i, /\breturn(?:ing|ed|s)?\b/i, /\bRTB\b/,
];
const AWAY = /\b(?:return(?:ing|ed|s)?\s+(?:home|stateside|to\s+(?:conus|the\s+(?:us|states)|base|home))|RTB|heading\s+(?:home|back)|homebound|back\s+(?:to|towards?)\s+(?:conus|the\s+(?:us|states)|home|base|europe)|rotating\s+home|redeploy(?:ing|ed)?\s+(?:home|back))\b/i;
const ORIGIN_CUE = /\b(?:from|out of|departed|departing|leaving|left|launched from|took off from|ex)\s+(?:the\s+)?$/i;
const DEST_CUE = /\b(?:to|into|for|toward|towards|at|in|bound for|arriv(?:ed|ing|al)\s+(?:at|in)|landed\s+(?:at|in)|landing\s+(?:at|in)|inbound\s+(?:to|for)?|on the ground at|on the ramp at|staging (?:at|in|out of)|heading (?:to|for|toward|towards))\s+(?:the\s+)?$/i;

interface PlaceDef { name: string; aor: Aor; rx: RegExp; icao?: string; mine?: boolean }
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The short name a spotter uses for a field: "Al Udeid AB, Qatar" → "Al Udeid". */
function shortName(label: string): string {
  return label.replace(/\s*,.*$/, "").replace(/\b(?:AFB|AB|JB|NAS|NS|RAF|Field|Intl|International|Airport|Air Base|Airbase)\b/g, "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}
function placeDefs(): PlaceDef[] {
  const out: PlaceDef[] = [];
  const seen = new Set<string>();
  const add = (name: string, aor: Aor, forms: string[], icao?: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // The hand list names its ICAO among the forms ("OMAM"); keep it so a
    // registry join can replace the entry by ICAO as well as by name.
    const id = icao ?? forms.find((f) => /^[A-Z]{4}$/.test(f));
    out.push({ name, aor, icao: id, rx: new RegExp(`\\b(?:${forms.map(escapeRx).join("|")})\\b`, "i") });
  };
  // The AMC hubs: the short name ("Al Udeid", "Ramstein", "Mildenhall") plus the ICAO.
  for (const region of AMC_HUBS) for (const h of region.hubs) {
    const short = shortName(h.name);
    const forms = [h.icao, ...short.split(/\s*\/\s*|-| and /).map((s) => s.trim()).filter((s) => s.length >= 4)];
    if (short.length >= 4) forms.push(short);
    add(short || h.icao, aorFromCoords(h.lat, h.lon), forms, h.icao);
  }
  const extra: [string, Aor, string[]][] = [
    ["Al Dhafra", "CENTCOM", ["Al Dhafra", "OMAM"]], ["Prince Sultan", "CENTCOM", ["PSAB", "Prince Sultan"]], ["Muwaffaq Salti", "CENTCOM", ["Muwaffaq Salti", "Azraq", "OJMS"]],
    ["Isa Air Base", "CENTCOM", ["Isa Air Base", "Shaikh Isa", "Sheikh Isa", "OBBS"]], ["Al Asad", "CENTCOM", ["Al Asad", "ORAA"]], ["Erbil", "CENTCOM", ["Erbil", "ORER"]],
    ["Djibouti", "AFRICOM", ["Djibouti", "Lemonnier", "HDAM"]], ["Diego Garcia", "INDOPACOM", ["Diego Garcia", "FJDG"]],
    ["Spangdahlem", "EUCOM", ["Spangdahlem", "ETAD"]], ["Fairford", "EUCOM", ["Fairford", "EGVA"]], ["Lakenheath", "EUCOM", ["Lakenheath", "EGUL"]],
    ["Morón", "EUCOM", ["Moron", "Morón", "LEMO"]], ["Souda Bay", "EUCOM", ["Souda", "LGSA"]], ["Akrotiri", "EUCOM", ["Akrotiri", "LCRA"]],
    ["Keflavik", "EUCOM", ["Keflavik", "BIKF"]], ["Pituffik", "NORTHCOM", ["Pituffik", "Thule", "BGTL"]], ["Powidz", "EUCOM", ["Powidz", "EPPW"]], ["Rzeszów", "EUCOM", ["Rzeszow", "Rzeszów", "EPRZ"]],
    ["Misawa", "INDOPACOM", ["Misawa", "RJSM"]], ["Iwakuni", "INDOPACOM", ["Iwakuni", "RJOI"]], ["Kunsan", "INDOPACOM", ["Kunsan", "RKJK"]], ["Clark", "INDOPACOM", ["Clark Air Base", "RPLC"]],
    ["Tinian", "INDOPACOM", ["Tinian", "PGWT"]], ["Wake Island", "INDOPACOM", ["Wake Island", "PWAK"]], ["Guam", "INDOPACOM", ["Guam"]], ["Okinawa", "INDOPACOM", ["Okinawa"]],
    ["Bagotville", "NORTHCOM", ["Bagotville"]], ["Soto Cano", "SOUTHCOM", ["Soto Cano", "MHSC"]], ["Guantanamo", "SOUTHCOM", ["Guantanamo", "GTMO", "MUGM"]], ["Curaçao", "SOUTHCOM", ["Curacao", "Curaçao", "Hato"]],
  ];
  for (const [name, aor, forms] of extra) add(name, aor, forms);
  return out;
}
const PLACES = placeDefs();

/** The catalogue with the operator's own fields joined in FRONT of it: a
 *  tracked field places a post by its label or ICAO and carries `mine`; a
 *  catalogue entry for the same field (an AMC hub you also track) is replaced
 *  by yours so the flag is kept. A field the registry cannot place (command
 *  UNKNOWN) is still matched — the post then reads UNKNOWN rather than
 *  falling through to a region guess, which is the honest answer. */
export function placesWithOwn(own: OwnPlace[] | undefined): PlaceDef[] {
  if (!own?.length) return PLACES;
  const defs: PlaceDef[] = [];
  const taken = new Set<string>();
  const takenIcao = new Set<string>();
  for (const o of own) {
    const icao = o.icao.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(icao) || takenIcao.has(icao)) continue;
    const short = shortName(o.label || icao);
    const forms = [icao, ...short.split(/\s*\/\s*|-| and /).map((s) => s.trim()).filter((s) => s.length >= 4)];
    if (short.length >= 4) forms.push(short);
    const name = short.length >= 3 ? short : icao;
    takenIcao.add(icao);
    taken.add(name.toLowerCase());
    defs.push({ name, aor: o.aor, icao, mine: true, rx: new RegExp(`\\b(?:${[...new Set(forms)].map(escapeRx).join("|")})\\b`, "i") });
  }
  for (const p of PLACES) {
    if (taken.has(p.name.toLowerCase()) || (p.icao && takenIcao.has(p.icao))) continue;
    defs.push(p);
  }
  return defs;
}

const REGION_AOR: [RegExp, Aor][] = [
  [/\b(?:middle east|persian gulf|the gulf|arabian gulf|red sea|hormuz|arabian sea|gulf of oman|levant|gulf region|centcom|the sandbox|the desert)\b/i, "CENTCOM"],
  [/\b(?:indo-pacific|western pacific|pacific|south china sea|taiwan strait|korean peninsula|east china sea|first island chain|indopacom|pacom)\b/i, "INDOPACOM"],
  [/\b(?:europe|baltic|black sea|eastern flank|mediterranean|the med|arctic|nordic|eucom|usafe)\b/i, "EUCOM"],
  [/\b(?:sahel|horn of africa|west africa|east africa|africom)\b/i, "AFRICOM"],
  [/\b(?:caribbean|latin america|south america|central america|southcom)\b/i, "SOUTHCOM"],
  [/\b(?:conus|the states|stateside|homeland|northcom)\b/i, "NORTHCOM"],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, "a dozen": 12, "half a dozen": 6, "a pair of": 2 };
const NUMBER_WORD_ENTRIES = Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length);
// The mover's own name must not place the move ("Russian airlift continues
// into Syria" is a CENTCOM move) — the lib/postureMoves rule.
const ACTOR_NAMES: Record<string, RegExp> = {
  "United States": /\bUS\b|\bU\.S\.|\bUSAF\b|\bAmerican\b|\bUnited States\b|\bAMC\b/g,
  Russia: /\bRussian?s?\b|\bMoscow\b|\bVKS\b|\bVTA\b/gi,
  China: /\bChin(?:a|ese)\b|\bPLAAF\b|\bPLA\b|\bBeijing\b/g,
  ally: /\bRAF\b|\bRoyal Air Force\b|\bBritish\b|\bFrench\b|\bGerman\b|\bLuftwaffe\b|\bNATO\b/g,
};

function hay(n: NewsItem): string { return `${n.title} ${n.summary ?? ""}`.replace(/\s+/g, " ").trim(); }

/** The airframes a text names, with the generic "tanker" / "airlifter" gated on context. */
export function airframesIn(text: string): AirframeDef[] {
  const out: AirframeDef[] = [];
  const aviation = AVIATION_CONTEXT.test(text);
  const maritime = MARITIME_CONTEXT.test(text);
  for (const a of AIRFRAMES) {
    if (!a.rx.test(text)) continue;
    if (a.generic && (!aviation || maritime)) continue;
    out.push(a);
  }
  return out;
}

/** The number stated just before an airframe token ("6x KC-135", "six tankers", "a dozen C-17s"), else null. */
export function statedCount(text: string, airframes: AirframeDef[]): number | null {
  let best: number | null = null;
  for (const a of airframes) {
    // Every mention of the type, not the first: "Big C-17 wave … a dozen
    // Globemasters" states the count before the second alias.
    const g = new RegExp(a.rx.source, a.rx.flags.includes("g") ? a.rx.flags : a.rx.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      if (m[0].length === 0) { g.lastIndex++; continue; }
      const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
      // A bare number ("6x", "4 ") — never the digits of a designator: the
      // "17" of a C-17 is not seventeen Globemasters.
      const digits = /(?:^|\s)(\d{1,2})\s*(?:x\s*|\s)?$/.exec(before.replace(/\s+/g, " ").trimEnd() + " ");
      let n: number | null = digits ? Number(digits[1]) : null;
      if (n == null) {
        // Longest phrase first: "half a dozen" must be read before "dozen".
        for (const [w, v] of NUMBER_WORD_ENTRIES) if (new RegExp(`\\b${w}\\s*$`).test(before.trimEnd())) { n = v; break; }
      }
      if (n != null && n > 0 && n <= 60 && (best == null || n > best)) best = n;
    }
  }
  return best;
}

/** Destination / origin places named in a text, by the cue words before them. */
export function placesIn(text: string, places: PlaceDef[] = PLACES): { dest: PlaceDef | null; origin: PlaceDef | null } {
  let dest: { p: PlaceDef; i: number } | null = null;
  let origin: { p: PlaceDef; i: number } | null = null;
  let bare: { p: PlaceDef; i: number } | null = null;
  for (const p of places) {
    const g = new RegExp(p.rx.source, "ig");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 28), m.index);
      if (ORIGIN_CUE.test(before)) { if (!origin || m.index < origin.i) origin = { p, i: m.index }; }
      else if (DEST_CUE.test(before)) { if (!dest || m.index < dest.i) dest = { p, i: m.index }; }
      else if (!bare || m.index < bare.i) bare = { p, i: m.index };
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  // A bare base name ("4x C-17 Al Udeid tonight") is read as the destination
  // only when no origin was cued — else it is more likely the other end.
  return { dest: dest?.p ?? (origin ? null : bare?.p ?? null), origin: origin?.p ?? null };
}

/** The AOR a post points at: the destination place, else a region phrase,
 *  else a country named (never the origin's). UNKNOWN is a real answer. */
export function resolveChatterAor(text: string, dest: PlaceDef | null, origin: PlaceDef | null, actor = "United States"): Aor {
  if (dest) return dest.aor;
  // A region phrase is read by its cue, like a place: one after "from / out
  // of" is the ORIGIN and never places the post; one after a destination cue
  // wins; else the first bare one (code review 2026-10-28: "from the Middle
  // East to Europe" filed as CENTCOM).
  let destRegion: { aor: Aor; i: number } | null = null, bareRegion: { aor: Aor; i: number } | null = null;
  for (const [re, aor] of REGION_AOR) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 28), m.index);
      if (ORIGIN_CUE.test(before)) { /* the other end */ }
      else if (DEST_CUE.test(before)) { if (!destRegion || m.index < destRegion.i) destRegion = { aor, i: m.index }; }
      else if (!bareRegion || m.index < bareRegion.i) bareRegion = { aor, i: m.index };
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  if (destRegion) return destRegion.aor;
  if (bareRegion) return bareRegion.aor;
  let stripped = text;
  if (origin) stripped = stripped.replace(origin.rx, " ");
  const own = ACTOR_NAMES[actor];
  if (own) stripped = stripped.replace(own, " ");
  return aorFromName(stripped);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Read every item for mobility chatter; items older than the window are
 *  ignored. `ownPlaces` (the tracking registry) joins the catalogue so a
 *  post naming your spoke places and is marked `mine`. */
export function readChatter(items: NewsItem[], nowMs: number = Date.now(), opts: { ownPlaces?: OwnPlace[] } = {}): ChatterPost[] {
  const out: ChatterPost[] = [];
  const places = placesWithOwn(opts.ownPlaces);
  for (const it of items) {
    const t = Date.parse(it.pubDate);
    if (!Number.isFinite(t) || nowMs - t > CHATTER_WINDOW_DAYS * DAY || t - nowMs > DAY) continue;
    const text = hay(it);
    const frames = airframesIn(text);
    if (!frames.length) continue;
    const move = MOVEMENT.map((re) => re.exec(text)).filter((m): m is RegExpExecArray => !!m).sort((a, b) => a.index - b.index)[0];
    if (!move) continue;
    const { dest, origin } = placesIn(text, places);
    // The side is the most specific airframe's: a named Russian or allied
    // type wins over the generic "tanker"; a US type wins over an ally's
    // generic mention. Ties go to the first declared.
    const specific = frames.filter((f) => !f.generic);
    const lead = (specific.length ? specific : frames)[0];
    const away = AWAY.test(text);
    // A return wave is placed by the command it LEAVES — "returning home
    // from Al Udeid" is CENTCOM lift going away.
    const aor = away && !dest && origin ? origin.aor : resolveChatterAor(text, dest, origin, lead.actor);
    const direction: ChatterDirection = away ? "away" : dest || aor !== "UNKNOWN" ? "toward" : "unclear";
    // A return wave is about the field it LEAVES — that field's SITREP row
    // should see "3 tankers departing", so the ICAO and the mine flag follow
    // the origin when the wave is placed by it.
    const field = away && !dest && origin ? origin : dest;
    out.push({
      id: `ch-${it.id}`,
      icao: field?.icao ?? null,
      mine: !!field?.mine,
      airframes: [...new Set(frames.map((f) => f.id))],
      classes: [...new Set(frames.map((f) => f.cls))],
      count: statedCount(text, frames),
      side: lead.side, actor: lead.actor,
      place: dest?.name ?? null, origin: origin?.name ?? null,
      aor, direction, phrase: move[0], text: text.slice(0, 280), link: it.link, source: (it.source || "").trim() || "unknown", pubDate: new Date(t).toISOString(),
    });
  }
  return out.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
}

/** One cluster per (AOR, side, direction): distinct sources corroborate. */
export function clusterChatter(posts: ChatterPost[]): ChatterCluster[] {
  const by = new Map<string, ChatterCluster & { srcSet: Set<string>; placeSet: Set<string>; frameSet: Set<string>; icaoSet: Set<string> }>();
  for (const p of posts) {
    const key = `${p.aor}|${p.side}|${p.direction}`;
    let c = by.get(key);
    if (!c) {
      c = { id: `ch-${slug(p.aor)}-${p.side}-${p.direction}`, aor: p.aor, side: p.side, actor: p.actor, direction: p.direction, reports: 0, sources: 0, corroborated: false, tankers: 0, airlifters: 0, count: null, airframes: [], places: [], icaos: [], mine: false, lead: p, pubDate: p.pubDate, srcSet: new Set(), placeSet: new Set(), frameSet: new Set(), icaoSet: new Set() };
      by.set(key, c);
    }
    c.reports++;
    if (p.mine) c.mine = true;
    if (p.icao) c.icaoSet.add(p.icao);
    c.srcSet.add(p.source);
    if (p.classes.includes("tanker")) c.tankers++;
    if (p.classes.includes("airlift")) c.airlifters++;
    if (p.count != null && (c.count == null || p.count > c.count)) c.count = p.count;
    for (const f of p.airframes) c.frameSet.add(f);
    if (p.place) c.placeSet.add(p.place);
    if (Date.parse(p.pubDate) > Date.parse(c.pubDate)) { c.pubDate = p.pubDate; c.lead = p; }
  }
  // Your own fields first (the Global Reach "mine" rule), then corroborated, then by volume.
  return [...by.values()].map(({ srcSet, placeSet, frameSet, icaoSet, ...c }) => ({ ...c, sources: srcSet.size, corroborated: srcSet.size >= 2, airframes: [...frameSet], places: [...placeSet], icaos: [...icaoSet] }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.corroborated) - Number(a.corroborated) || b.reports - a.reports || Date.parse(b.pubDate) - Date.parse(a.pubDate));
}

export interface FieldChatter {
  icao: string;
  reports: number;
  /** Distinct handles / feeds. */
  sources: number;
  corroborated: boolean;
  tankers: number;
  airlifters: number;
  /** The largest count any post stated, else null. */
  count: number | null;
  airframes: string[];
  /** Inbound reports vs reports of lift leaving the field. */
  inbound: number;
  outbound: number;
  lead: { source: string; text: string; link: string; pubDate: string };
  pubDate: string;
}

/** Chatter naming ONE field — as the destination, or as the origin of a
 *  return wave — inside the window. Null when no post names it, so the
 *  SITREP row can tell "no chatter" from "chatter says nothing". Reporting
 *  beside the field's ADS-B count, never in place of it. */
export function chatterForIcao(posts: ChatterPost[], icao: string, nowMs: number, hours = CHATTER_SENSOR_HOURS): FieldChatter | null {
  const want = icao.trim().toUpperCase();
  if (!want) return null;
  const cutoff = nowMs - hours * 3_600_000;
  const hits = posts.filter((p) => p.icao === want && Date.parse(p.pubDate) >= cutoff);
  if (!hits.length) return null;
  const srcs = new Set(hits.map((p) => p.source));
  const counts = hits.map((p) => p.count).filter((n): n is number => n != null);
  const lead = hits[0];
  return {
    icao: want, reports: hits.length, sources: srcs.size, corroborated: srcs.size >= 2,
    tankers: hits.filter((p) => p.classes.includes("tanker")).length,
    airlifters: hits.filter((p) => p.classes.includes("airlift")).length,
    count: counts.length ? Math.max(...counts) : null,
    airframes: [...new Set(hits.flatMap((p) => p.airframes))],
    inbound: hits.filter((p) => p.direction !== "away").length,
    outbound: hits.filter((p) => p.direction === "away").length,
    lead: { source: lead.source, text: lead.text, link: lead.link, pubDate: lead.pubDate },
    pubDate: lead.pubDate,
  };
}

/** One line for a SITREP Ops row: "3 reports from 2 handles naming OJAQ · tankers 2 · up to 6 stated · newest 4h ago". */
export function fieldChatterLine(f: FieldChatter, relTime?: (iso: string) => string): string {
  const parts = [`${f.reports} report${f.reports === 1 ? "" : "s"} from ${f.sources} ${f.sources === 1 ? "handle" : "handles"} naming ${f.icao}`];
  const what = [f.tankers ? `tankers ${f.tankers}` : "", f.airlifters ? `airlift ${f.airlifters}` : ""].filter(Boolean).join(" · ");
  if (what) parts.push(what);
  if (f.count) parts.push(`up to ${f.count} stated`);
  if (f.outbound) parts.push(f.inbound ? `${f.inbound} inbound · ${f.outbound} departing` : `${f.outbound} departing`);
  if (relTime) parts.push(`newest ${relTime(f.pubDate)}`);
  return parts.join(" · ");
}

export interface ChatterSurge { reports: number; sources: number; tankers: number; airlifters: number; count: number | null; lead: string | null }

/** Chatter TOWARD (or unclear but placed in) one command inside the sensor
 *  window, by the given side. Nothing → null, so the caller can tell "no
 *  chatter" from "chatter says nothing". */
export function chatterSurge(posts: ChatterPost[], aor: Aor, nowMs: number, opts: { hours?: number; side?: ActorSide } = {}): ChatterSurge | null {
  const hours = opts.hours ?? CHATTER_SENSOR_HOURS;
  const side = opts.side ?? "us";
  const cutoff = nowMs - hours * 3_600_000;
  const hits = posts.filter((p) => p.aor === aor && p.side === side && p.direction !== "away" && Date.parse(p.pubDate) >= cutoff);
  if (!hits.length) return null;
  const sources = new Set(hits.map((p) => p.source)).size;
  const counts = hits.map((p) => p.count).filter((n): n is number => n != null);
  return {
    reports: hits.length, sources,
    tankers: hits.filter((p) => p.classes.includes("tanker")).length,
    airlifters: hits.filter((p) => p.classes.includes("airlift")).length,
    count: counts.length ? Math.max(...counts) : null,
    lead: hits[0] ? `${hits[0].source}: ${hits[0].text.slice(0, 100)}` : null,
  };
}

const LIFT_FALSIFIER = "ADS-B shows no mobility or tanker lift above the command's own normal within 72 h, or the aircraft are reported returning.";

/** Chatter clusters as posture moves of kind `lift` — only lift placed in a
 *  command and not returning home. A return wave is reported on the chatter
 *  line, never as a move. */
export function chatterToMoves(clusters: ChatterCluster[]): PostureMove[] {
  const out: PostureMove[] = [];
  for (const c of clusters) {
    if (c.aor === "UNKNOWN" || c.direction === "away") continue;
    const what = [c.tankers ? `${c.tankers} tanker report${c.tankers === 1 ? "" : "s"}` : "", c.airlifters ? `${c.airlifters} airlift report${c.airlifters === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
    const where = c.places.length ? c.places.join(" / ") : c.aor;
    out.push({
      id: `pm-lift-${slug(c.actor)}-${c.aor}`,
      kind: "lift", actor: c.actor, side: c.side, aor: c.aor,
      headline: `Lift reported ${c.direction === "toward" ? "toward" : "around"} ${where} — ${what}${c.count ? `, up to ${c.count} stated` : ""} (${c.airframes.join(", ")})`,
      link: c.lead.link, source: c.lead.source, pubDate: c.pubDate, sources: c.sources, corroborated: c.corroborated,
      phrase: c.lead.phrase, falsifier: LIFT_FALSIFIER,
    });
  }
  return out;
}

/** The newest chatter line for a command, for a strip. */
export function chatterLine(c: ChatterCluster, relTime?: (iso: string) => string): string {
  const parts = [`${c.reports} report${c.reports === 1 ? "" : "s"} from ${c.sources} ${c.sources === 1 ? "handle" : "handles"}`];
  const what = [c.tankers ? `tankers ${c.tankers}` : "", c.airlifters ? `airlift ${c.airlifters}` : ""].filter(Boolean).join(" · ");
  if (what) parts.push(what);
  if (c.count) parts.push(`up to ${c.count} stated`);
  if (c.places.length) parts.push(`${c.direction === "away" ? "from" : "toward"} ${c.places.join(" / ")}`);
  if (relTime) parts.push(`newest ${relTime(c.pubDate)}`);
  return `${c.aor} · ${c.direction === "away" ? "returning" : c.direction === "toward" ? "inbound" : "moving"} — ${parts.join(" · ")}`;
}
