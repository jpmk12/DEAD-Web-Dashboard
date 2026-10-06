// Chokepoint interdiction: what was DONE, not how often it was mentioned.
//
// PURE, client-safe, unit-tested. Dependency-free by the same rule as
// `lib/airfields.ts` — the haversine is INLINED rather than imported from
// `lib/disasters.ts`, because `lib/chokepoints.ts` is imported by client code
// and pulling the disasters tree would drag `rss-parser` into the browser
// bundle. Keep it that way.
//
// ── What was wrong ────────────────────────────────────────────────────────
// `scoreChokepoints` counted keyword mentions in headlines. A tanker struck by
// a missile in the Strait of Hormuz and an op-ed about the Strait of Hormuz
// scored identically — volume, not events. That is precisely what the I&W
// board's anomaly doctrine exists to avoid, and the Economy tab was the last
// surface still doing it.
//
// Two fixes, which are really one:
//
//   1. GEOGRAPHY. Chokepoints carry lat/lon and so do UCDP/ACLED events. An
//      attack 40 km off Bab-el-Mandeb was already in the database and this
//      surface could not see it. Events are joined by distance.
//
//   2. MODALITY. The op-ed problem is not solved by a topic filter, because an
//      op-ed and a strike report share every keyword. What separates them is
//      MOOD: "struck a tanker" versus "could strike tankers". So text is
//      graded ACT / THREAT / ANALYSIS, and only an ACT counts as interdiction.
//
// A THREAT IS NOT SUPPRESSED, it is tiered. A declared closure is a real
// warning signal even though nothing has happened yet — the Hormuz indicator's
// own falsifier names "closure declarations" alongside mining and seizures.
// Throwing threats away would lose the earliest signal there is; scoring them
// as acts would make the board cry wolf. They are worth different amounts.

// `reversal` (REVIEW-2026-10 §10 E3): the measure being LIFTED — "the strait
// has reopened", "gas flows resumed", "sanctions lifted". The old grammar
// graded "Traffic has resumed after the blockade was lifted" as a closure
// ACT because "blockade" is a closure phrase; the reader sees the board go
// red on the day the strait reopens. A reversal earns NO weight and is
// never counted as an act, threat or analysis piece — it is shown so the
// row explains itself, and it is the only modality that can stand for
// de-escalation.
export type Modality = "act" | "threat" | "analysis" | "reversal";

export type InterdictionClass =
  | "strike"      // vessel hit by missile/drone/explosive
  | "seizure"     // boarded, seized, detained, hijacked
  | "mining"      // mines laid or found
  | "closure"     // transit closed / blockaded / declared closed
  | "rerouting"   // traffic avoiding the route — the economic effect landing
  | "escort"      // convoy / naval escort established, i.e. it is contested
  | "airspace";   // overflight denied or closed

export interface InterdictionRead {
  cls: InterdictionClass;
  modality: Modality;
  /** The phrase that matched — every row states its own evidence. */
  phrase: string;
  /** Points contributed, after the modality discount. */
  weight: number;
}

/** Base weight per class, before modality. A strike outranks commentary about
 *  rerouting; rerouting outranks an escort because it is the effect, not the
 *  response. */
const CLASS_WEIGHT: Record<InterdictionClass, number> = {
  closure: 100, mining: 90, strike: 85, seizure: 75,
  rerouting: 60, airspace: 55, escort: 35,
};

/** Modality multipliers. An act is the event; a threat is the earliest signal;
 *  analysis is someone thinking out loud and earns almost nothing. */
const MODALITY_FACTOR: Record<Modality, number> = { act: 1, threat: 0.45, analysis: 0.1, reversal: 0 };

// Phrases per class. Phrases, never single words — "attack" and "closed" appear
// in every shipping newsletter ever written. Same rule as accountJeopardy.
const CLASS_PHRASES: Record<InterdictionClass, string[]> = {
  strike: [
    "struck a tanker", "struck a vessel", "hit by a missile", "hit by a drone",
    "missile struck", "drone struck", "attacked a tanker", "attacked a vessel",
    "attack on a tanker", "attack on shipping", "vessel was attacked",
    "ship was attacked", "struck by a projectile", "explosion aboard",
    "limpet mine", "damaged by an explosion", "set ablaze", "sank after",
  ],
  seizure: [
    "seized a tanker", "seized a vessel", "boarded a tanker", "boarded a vessel",
    "hijacked", "detained the crew", "seized the ship", "commandeered",
    "tanker seizure", "vessel seizure",
  ],
  // Verb agreement matters: a plural subject ("mines were found") must match as
  // surely as a singular one, or a real event grades as something weaker.
  mining: [
    "laid mines", "laying mines", "naval mines", "sea mines", "mined the strait", "demining",
    "mine was found", "mines were found", "mines found", "mine found", "mines discovered",
  ],
  closure: [
    "closed the strait", "close the strait", "closing the strait", "strait is closed",
    "blockade", "blockading", "declared closed", "closure of the strait",
    "shut the strait", "halted all transits", "suspended transits",
  ],
  rerouting: [
    "rerouting around", "diverted around the cape", "avoiding the red sea",
    "rerouted away", "suspended sailings", "pausing transits", "diverting vessels",
    "traffic has fallen", "transits have fallen", "war risk premium",
    "war-risk premium", "insurance rates have", "no longer transiting",
  ],
  escort: ["naval escort", "convoy system", "escorting vessels", "task force to protect", "coalition patrols"],
  airspace: [
    "airspace closed", "closed its airspace", "overflight denied", "overflight rights revoked",
    "denied overflight", "airspace restriction", "notam closing",
  ],
};

// Conditional / hypothetical mood. Their presence anywhere in a short headline
// is enough to demote it: a headline is one clause, so a modal almost always
// governs the whole claim.
// Both singular and plural forms: "Iran threatens" and "the Houthis threaten"
// are the same signal, and missing the plural silently grades a declared threat
// as a completed act — the most damaging direction to be wrong in.
const THREAT_MARKERS = [
  "threatens to", "threaten to", "threatened to", "threatening to",
  "vows to", "vow to", "vowed to",
  "warns it will", "warn it will", "has warned", "have warned",
  "says it will", "say it will", "said it will",
  "pledges to", "pledge to", "prepared to", "ready to",
  "intends to", "intend to", "if attacked", "in retaliation", "unless", "ultimatum",
];
const ANALYSIS_MARKERS = [
  "could", "may", "might", "would", "risk of", "fears", "scenario",
  "analysts", "analysis", "opinion", "op-ed", "commentary", "what if",
  "how a", "why the", "explainer", "anniversary", "lessons from",
  "in the event", "were to", "hypothetical", "war game", "wargame",
];

// The measure being undone. PHRASES, never single words ("open" is in every
// headline); each one names the END of a coercive state, so a text that
// carries one alongside a closure / seizure / supply-cut phrase is reporting
// the lifting, not the imposition. Shared by every grammar that grades
// modality (chokepoint, instrument, cyber) through `isReversal`.
const REVERSAL_PHRASES = [
  "has reopened", "have reopened", "reopened the strait", "reopen the strait", "reopening the strait", "reopening of the strait",
  "strait reopened", "strait has reopened", "reopened to shipping", "reopen its airspace", "resume transits", "resume gas deliveries",
  "resume gas supplies", "resume oil exports", "restore gas supplies", "lift the blockade", "lift the embargo", "lift the ban",
  "reopened to traffic", "reopens the strait", "reopened its airspace", "airspace reopened", "airspace has reopened",
  "traffic has resumed", "transits have resumed", "transits resumed", "shipping has resumed", "resumed transits",
  "resumed sailings", "sailings resumed", "flows have resumed", "flows resumed", "gas flows resumed", "supplies resumed",
  "deliveries resumed", "resumed deliveries", "resumed gas deliveries", "resumed oil exports", "exports resumed",
  "lifted the blockade", "blockade lifted", "blockade was lifted", "ended the blockade", "lifted the ban", "ban lifted",
  "ban was lifted", "lifted the embargo", "embargo lifted", "lifted the closure", "closure lifted", "lifted the restrictions",
  "restrictions lifted", "restrictions were lifted", "eased the restrictions", "lifted sanctions", "sanctions lifted",
  "sanctions were lifted", "sanctions relief", "released the tanker", "released the vessel", "released the ship",
  "released the crew", "tanker was released", "vessel was released", "freed the tanker", "freed the vessel",
  "mines were cleared", "mines cleared", "channel was cleared", "suspended the tariffs", "tariffs suspended",
  "dropped the tariffs", "withdrew the tariffs", "tariffs were lifted", "removed from the entity list",
  "delisted", "overflight restored", "overflight rights restored", "resumed overflights", "restored gas supplies",
  "restored supplies", "back to normal", "returned to normal", "declared the strait open", "ceasefire holds",
];

/** Does the text report a coercive measure being LIFTED? */
export function isReversal(text: string): boolean {
  if (!text) return false;
  return REVERSAL_PHRASES.some((p) => hasPhrase(text, p));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-bounded, case-insensitive phrase containment. */
export function hasPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])`, "iu").test(text);
  } catch {
    return false;
  }
}

/** Grade the mood of a claim. Threat beats analysis: "Iran threatens to close
 *  the strait, analysts say" is a declared intent being reported, not a
 *  hypothetical, and the declaration is the signal. */
export function gradeModality(text: string): Modality {
  // A lifting outranks everything: "Iran vows to reopen the strait" is a
  // promise of de-escalation, and a reversal headline that a modal happens
  // to govern must not be upgraded back into a threat.
  if (isReversal(text)) return "reversal";
  if (THREAT_MARKERS.some((m) => hasPhrase(text, m))) return "threat";
  if (ANALYSIS_MARKERS.some((m) => hasPhrase(text, m))) return "analysis";
  return "act";
}

/** Classify one piece of text. Returns the strongest class present, or null
 *  when nothing interdiction-shaped is said at all — a mere mention of the
 *  chokepoint's name earns nothing, which is the whole point. */
export function readInterdiction(text: string): InterdictionRead | null {
  const modality = gradeModality(text);
  let best: InterdictionRead | null = null;
  for (const cls of Object.keys(CLASS_PHRASES) as InterdictionClass[]) {
    const phrase = CLASS_PHRASES[cls].find((p) => hasPhrase(text, p));
    if (!phrase) continue;
    const weight = Math.round(CLASS_WEIGHT[cls] * MODALITY_FACTOR[modality]);
    if (!best || weight > best.weight) best = { cls, modality, phrase, weight };
  }
  return best;
}

// ───────────────────────────── geography ─────────────────────────────

/** Inlined haversine — see the header note about keeping this module
 *  dependency-free. Kilometres. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** A georeferenced event, narrowed so this module never imports a feed. */
export interface GeoEvent {
  id: string;
  lat: number;
  lon: number;
  title: string;
  /** yyyy-mm-dd. */
  date?: string;
  fatalities?: number | null;
  source?: string;
}

/** Default join radius. Wide because the relevant attacks are rarely IN the
 *  strait: Houthi strikes land across the Red Sea and Gulf of Aden, hundreds of
 *  kilometres from the Bab-el-Mandeb waypoint. A per-chokepoint override lives
 *  on the chokepoint itself — the Panama Canal does not want 300 km. */
export const DEFAULT_RADIUS_KM = 300;

/** Days of event history considered. */
export const EVENT_WINDOW_DAYS = 45;

export interface NearbyEvent extends GeoEvent {
  distanceKm: number;
  /** Days ago, or null when the event carries no usable date. */
  ageDays: number | null;
}

/** Events within radius, nearest-and-newest first. An event with no usable date
 *  is KEPT (position is the evidence; UCDP rows can lack a clean date) but
 *  reported with a null age rather than a guessed one. */
export function eventsNear(
  point: { lat: number; lon: number; radiusKm?: number },
  events: GeoEvent[],
  today: string,
  opts: { windowDays?: number; radiusKm?: number } = {},
): NearbyEvent[] {
  const radius = point.radiusKm ?? opts.radiusKm ?? DEFAULT_RADIUS_KM;
  const windowDays = opts.windowDays ?? EVENT_WINDOW_DAYS;
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  const out: NearbyEvent[] = [];
  for (const e of events) {
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
    if (e.lat === 0 && e.lon === 0) continue;            // null island, not a location
    const distanceKm = haversineKm(point.lat, point.lon, e.lat, e.lon);
    if (distanceKm > radius) continue;

    let ageDays: number | null = null;
    if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(todayMs)) {
      const t = Date.parse(`${e.date}T00:00:00Z`);
      if (Number.isFinite(t)) {
        ageDays = Math.round((todayMs - t) / 86_400_000);
        if (ageDays > windowDays) continue;              // outside the window
        if (ageDays < -1) continue;                      // a future date is bad data
      }
    }
    out.push({ ...e, distanceKm: Math.round(distanceKm), ageDays });
  }
  out.sort((a, b) => (a.ageDays ?? 9999) - (b.ageDays ?? 9999) || a.distanceKm - b.distanceKm);
  return out;
}

// ───────────────────────────── the signal ─────────────────────────────

export interface ChokepointText {
  title: string;
  summary?: string;
  link?: string;
  source?: string;
  pubDate?: string;
}

export interface ActivityRead {
  /** 0-100, from graded text and nearby events. */
  score: number;
  /** Highest-weighted interdiction read, when any. */
  lead: (InterdictionRead & { title: string; link?: string; source?: string; pubDate?: string }) | null;
  /** Counts by modality, so the UI can say "2 acts, 5 threats". */
  acts: number;
  threats: number;
  analysis: number;
  /** Georeferenced events near the point. */
  events: NearbyEvent[];
  /** One sentence, or null when nothing is happening. */
  line: string | null;
}

/** Recency discount for text. A strike reported five weeks ago is history. */
function recencyFactor(pubDate: string | undefined, todayMs: number): number {
  if (!pubDate) return 0.6;                    // undated — real but not fresh
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return 0.6;
  const days = (todayMs - t) / 86_400_000;
  if (days <= 3) return 1;
  if (days <= 7) return 0.8;
  if (days <= 21) return 0.5;
  return 0.25;
}

/**
 * Grade one chokepoint from text and events.
 *
 * `texts` must already be filtered to this chokepoint (the caller matches on
 * the chokepoint's own keywords), so this function never re-implements topic
 * matching — it only judges what kind of claim is being made.
 */
export function readActivity(
  point: { lat: number; lon: number; radiusKm?: number },
  texts: ChokepointText[],
  events: GeoEvent[],
  today: string,
  opts: { windowDays?: number } = {},
): ActivityRead {
  const todayMs = Date.parse(`${today}T00:00:00Z`) || Date.now();
  let acts = 0, threats = 0, analysis = 0, textScore = 0;
  let lead: ActivityRead["lead"] = null;

  for (const t of texts) {
    const read = readInterdiction(`${t.title} ${t.summary ?? ""}`);
    if (!read) continue;                       // a bare mention earns nothing
    if (read.modality === "reversal") continue;  // the measure being lifted — not an act, not a threat, not analysis
    if (read.modality === "act") acts++;
    else if (read.modality === "threat") threats++;
    else analysis++;

    const weighted = read.weight * recencyFactor(t.pubDate, todayMs);
    textScore += weighted;
    if (!lead || read.weight > lead.weight) {
      lead = { ...read, title: t.title, link: t.link, source: t.source, pubDate: t.pubDate };
    }
  }

  const nearby = eventsNear(point, events, today, opts);
  // Events are hard evidence and score more heavily than any amount of text,
  // but with diminishing returns: twenty incidents is not twenty times one.
  const eventScore = nearby.length > 0 ? 40 + Math.min(45, Math.round(18 * Math.log2(1 + nearby.length))) : 0;

  const score = Math.max(0, Math.min(100, Math.round(Math.min(55, textScore) + eventScore)));

  const parts: string[] = [];
  if (acts > 0) parts.push(`${acts} reported ${acts === 1 ? "act" : "acts"}`);
  if (threats > 0) parts.push(`${threats} declared ${threats === 1 ? "threat" : "threats"}`);
  if (nearby.length > 0) parts.push(`${nearby.length} georeferenced ${nearby.length === 1 ? "incident" : "incidents"} within ${point.radiusKm ?? DEFAULT_RADIUS_KM} km`);
  if (parts.length === 0 && analysis > 0) parts.push(`${analysis} analysis ${analysis === 1 ? "piece" : "pieces"} only`);

  return { score, lead, acts, threats, analysis, events: nearby, line: parts.length > 0 ? parts.join(" · ") : null };
}
