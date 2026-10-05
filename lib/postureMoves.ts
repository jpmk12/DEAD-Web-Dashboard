// Force-posture MOVES in the day's reporting — PURE, client-safe, unit-tested.
//
// The 2026-10-05 Glance walkthrough nearly missed a major air-force posture
// change: it sat as one headline among forty in "On your radar". For a
// mobility squadron a posture move IS the demand signal — a carrier ordered
// to the Gulf, bombers forward-deployed, a reserve call-up, an adversary
// mobilising — because each one pulls airlift behind it. Nothing in the app
// read for that grammar; the I&W boards read conflict intensity and rhetoric,
// not movement.
//
// Discipline (the same as lib/economicWarfare and lib/cyberSignals):
//   • PHRASES, never single words, and a FORCE-NOUN gate — "deploys" alone
//     matches a software release; "deploys … bombers" does not.
//   • The ACTOR is resolved by proximity: the named force closest BEFORE the
//     matched phrase is the mover ("Iran on alert as US deploys bombers" →
//     US). Unattributed moves are kept but say so.
//   • One row per (kind, actor, AOR); distinct sources corroborate. A single
//     source is a lead, flagged as such, never a confirmed move.
//   • Every move carries a FALSIFIER — what would show it was not a move.
//   • Recency is the demand-horizon's business (lib/demandHorizon decays and
//     caps); this module only reports what the reporting says, with a date.

import type { NewsItem, NewsletterSummary } from "./types";
import { aorFromName, type Aor } from "./aor";

export type MoveKind = "deploy" | "surge" | "mobilize" | "reposition" | "exercise" | "withdraw";
export type ActorSide = "us" | "ally" | "adversary" | "other";

export interface PostureMove {
  id: string;
  kind: MoveKind;
  actor: string;
  side: ActorSide;
  aor: Aor;
  headline: string;
  link: string;
  source: string;
  pubDate: string;
  /** Distinct sources reporting this (kind, actor, AOR). */
  sources: number;
  corroborated: boolean;
  phrase: string;
  falsifier: string;
}

export const MOVE_LABEL: Record<MoveKind, string> = {
  deploy: "deployment", surge: "surge", mobilize: "mobilisation", reposition: "repositioning", exercise: "exercise", withdraw: "withdrawal",
};
export const SIDE_LABEL: Record<ActorSide, string> = { us: "U.S.", ally: "ally", adversary: "adversary", other: "other" };

const FALSIFIER: Record<MoveKind, string> = {
  deploy: "No corroborating report of arrival or movement within 7 days, or an official denial.",
  surge: "No corroborating report of the additional forces arriving within 7 days.",
  mobilize: "Alert status reported lowered, or no follow-on reporting within 7 days.",
  reposition: "Forces reported in their previous location after the move window.",
  exercise: "The exercise concludes on schedule with forces returning to garrison.",
  withdraw: "Forces reported still in place after the stated withdrawal window.",
};

// ── Grammar ──────────────────────────────────────────────────────────────
const UNITS = "troops|forces|warships?|destroyers?|frigates?|fighters?|bombers?|jets|aircraft|carrier|marines|soldiers|squadrons?|battalions?|brigades?|missiles?|launchers?|air defen[cs]es?|tankers?|airlifters?";
const REGIONS = "region|gulf|middle east|pacific|indo-pacific|mediterranean|red sea|black sea|baltic|border|peninsula|europe|strait|south china sea|caribbean";

const KIND_PATTERNS: Record<MoveKind, RegExp[]> = {
  deploy: [
    /\bdeploy(?:s|ed|ing|ment of)\b/i,
    new RegExp(`\\b(?:send|sends|sending|sent|dispatch(?:es|ed|ing)?)\\s+(?:\\w+\\s+){0,3}?(?:${UNITS})\\b`, "i"),
    /\bcarrier strike group\b/i, /\bamphibious ready group\b/i,
    new RegExp(`\\barriv(?:es|ed|ing)\\s+in\\s+the\\s+(?:${REGIONS})\\b`, "i"),
    /\bforward[- ]deploy/i,
    new RegExp(`\\border(?:s|ed)\\s+(?:\\w+\\s+){0,4}?to\\s+the\\s+(?:${REGIONS})\\b`, "i"),
  ],
  surge: [
    new RegExp(`\\bsurg(?:e|es|ed|ing)\\s+(?:of\\s+)?(?:\\w+\\s+){0,2}?(?:${UNITS}|assets)\\b`, "i"),
    /\breinforc(?:e|es|ed|ing|ements)\b/i,
    new RegExp(`\\badditional\\s+(?:\\w+\\s+){0,2}?(?:${UNITS})\\b`, "i"),
    /\bbolster(?:s|ed|ing)\s+(?:\w+\s+){0,3}?(?:presence|forces|defen[cs]es|posture)\b/i,
  ],
  mobilize: [
    /\bmobili[sz](?:e|es|ed|ing|ation)\b/i, /\bcall(?:s|ed|ing)?\s+up\s+(?:\w+\s+){0,2}?reserv/i, /\breservists\b/i,
    /\b(?:heightened|highest|raised|elevated)\s+(?:state\s+of\s+)?alert\b/i, /\bplaced\s+on\s+(?:high\s+)?alert\b/i, /\bon\s+high\s+alert\b/i,
    /\bDEFCON\b/, /\bcombat readiness\b/i,
  ],
  reposition: [
    /\breposition(?:s|ed|ing)?\b/i,
    new RegExp(`\\brelocat(?:es|ed|ing)\\s+(?:\\w+\\s+){0,2}?(?:${UNITS})\\b`, "i"),
    new RegExp(`\\b(?:moves|moved|moving)\\s+(?:\\w+\\s+){0,2}?(?:${UNITS})\\b`, "i"),
    /\btransit(?:s|ed|ing)\s+the\s+(?:taiwan\s+)?strait\b/i,
    /\benter(?:s|ed|ing)\s+the\s+(?:south china sea|mediterranean|black sea|red sea|persian gulf|gulf|baltic)\b/i,
  ],
  exercise: [
    /\b(?:military|naval|joint|live[- ]fire|large[- ]scale)\s+(?:exercise|drill)s?\b/i, /\bwar\s?games?\b/i,
    /\b(?:exercise|drill)s?\s+(?:near|around|off|in|with)\b/i,
  ],
  withdraw: [
    /\bwithdraw(?:s|al|n|ing)?\b/i, /\bpull(?:s|ed|ing)?\s+(?:out|back)\b/i, /\bdrawdown\b/i,
    /\bredeploy(?:s|ed|ment)?\s+(?:home|out|back)\b/i, /\bstand(?:s)?\s+down\b/i,
  ],
};
// Order decides which kind a text that matches several is filed under: the
// most consequential first. "withdraw" last so "withdraws … and redeploys to
// the Gulf" reads as a deployment.
const KIND_ORDER: MoveKind[] = ["mobilize", "deploy", "surge", "reposition", "exercise", "withdraw"];

const FORCE_NOUN = new RegExp(`\\b(?:${UNITS}|sailors|airmen|wings?|divisions?|fleet|navy|army|air force|military|patriot|thaad|pla|irgc|nato|pentagon|ministry of defen[cs]e|defen[cs]e ministry|reservists)\\b`, "i");

interface ActorDef { name: string; side: ActorSide; aliases: RegExp[] }
const ACTORS: ActorDef[] = [
  { name: "United States", side: "us", aliases: [
    // Case-sensitive on purpose: "US" as a capitalised token is the country;
    // the pronoun is "us". The `i` aliases below never include it.
    /\bU\.S\.(?:A\.)?/, /\bUS\b/,
    /\bunited states\b/i, /\bamerican\s+(?:forces|troops|warships?|military|carrier|bombers?|fighters?)\b/i, /\bpentagon\b/i, /\busaf\b/i,
    /\bcentcom\b/i, /\bindopacom\b/i, /\beucom\b/i, /\bafricom\b/i, /\bwashington\s+(?:sends|orders|deploys|moves)\b/i,
  ] },
  { name: "China", side: "adversary", aliases: [/\bchin(?:a|ese)\b/i, /\bbeijing\b/i, /\bPLA\b/, /\bpeople's liberation army\b/i] },
  { name: "Russia", side: "adversary", aliases: [/\brussia(?:n)?\b/i, /\bkremlin\b/i, /\bmoscow\b/i] },
  { name: "Iran", side: "adversary", aliases: [/\biran(?:ian)?\b/i, /\btehran\b/i, /\birgc\b/i, /\brevolutionary guard/i] },
  { name: "North Korea", side: "adversary", aliases: [/\bnorth korea(?:n)?\b/i, /\bdprk\b/i, /\bpyongyang\b/i] },
  { name: "Houthis", side: "adversary", aliases: [/\bhouthis?\b/i, /\bansar allah\b/i] },
  { name: "Israel", side: "ally", aliases: [/\bisrael(?:i)?\b/i, /\bidf\b/i] },
  { name: "NATO", side: "ally", aliases: [/\bnato\b/i] },
  { name: "United Kingdom", side: "ally", aliases: [/\bbritain\b/i, /\bbritish\b/i, /\bUK\b/, /\broyal navy\b/i, /\broyal air force\b/i] },
  { name: "France", side: "ally", aliases: [/\bfrance\b/i, /\bfrench\b/i] },
  { name: "Germany", side: "ally", aliases: [/\bgerman(?:y)?\b/i, /\bbundeswehr\b/i] },
  { name: "Turkey", side: "ally", aliases: [/\bturk(?:ey|ish)\b/i, /\bankara\b/i] },
  { name: "Japan", side: "ally", aliases: [/\bjapan(?:ese)?\b/i, /\bjsdf\b/i, /\btokyo\b/i] },
  { name: "South Korea", side: "ally", aliases: [/\bsouth korea(?:n)?\b/i, /\bseoul\b/i, /\bROK\b/] },
  { name: "Australia", side: "ally", aliases: [/\baustralia(?:n)?\b/i, /\bcanberra\b/i] },
  { name: "Taiwan", side: "other", aliases: [/\btaiwan(?:ese)?\b/i, /\btaipei\b/i] },
  { name: "Ukraine", side: "other", aliases: [/\bukrain(?:e|ian)\b/i, /\bkyiv\b/i] },
  { name: "India", side: "other", aliases: [/\bindia(?:n)?\b/i, /\bnew delhi\b/i] },
  { name: "Pakistan", side: "other", aliases: [/\bpakistan(?:i)?\b/i, /\bislamabad\b/i] },
  { name: "Saudi Arabia", side: "other", aliases: [/\bsaudi\b/i, /\briyadh\b/i] },
  { name: "Egypt", side: "other", aliases: [/\begypt(?:ian)?\b/i, /\bcairo\b/i] },
  { name: "Venezuela", side: "other", aliases: [/\bvenezuela(?:n)?\b/i, /\bcaracas\b/i] },
  { name: "Philippines", side: "ally", aliases: [/\bphilippine(?:s)?\b/i, /\bmanila\b/i] },
];

// Region phrases that name the theatre when no country does.
const REGION_AOR: [RegExp, Aor][] = [
  [/\b(?:middle east|persian gulf|the gulf|red sea|hormuz|arabian sea|levant|gulf region)\b/i, "CENTCOM"],
  [/\b(?:indo-pacific|pacific|south china sea|taiwan strait|korean peninsula|east china sea|first island chain)\b/i, "INDOPACOM"],
  [/\b(?:europe|baltic|black sea|eastern flank|mediterranean|arctic|nordic)\b/i, "EUCOM"],
  [/\b(?:sahel|horn of africa|west africa|east africa)\b/i, "AFRICOM"],
  [/\b(?:caribbean|latin america|south america|central america)\b/i, "SOUTHCOM"],
  [/\b(?:homeland|continental united states|conus)\b/i, "NORTHCOM"],
];

const MAX_AGE_DAYS = 14;
const DAY = 86_400_000;

function hay(a: NewsItem): string { return `${a.title}. ${a.summary ?? ""}`; }

function firstMatch(text: string, kind: MoveKind): { index: number; phrase: string } | null {
  let best: { index: number; phrase: string } | null = null;
  for (const re of KIND_PATTERNS[kind]) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, phrase: m[0] };
  }
  return best;
}

/** The actor nearest BEFORE `at` (else the first mentioned), with the spans
 *  of every alias hit so the AOR pass can ignore the mover's own name. */
function resolveActor(text: string, at: number): { actor: ActorDef | null; spans: [number, number][] } {
  let before: { d: ActorDef; i: number } | null = null;
  let first: { d: ActorDef; i: number } | null = null;
  const spans: [number, number][] = [];
  for (const d of ACTORS) {
    for (const re of d.aliases) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = g.exec(text)) !== null) {
        spans.push([m.index, m.index + m[0].length]);
        if (m.index < at && (!before || m.index > before.i)) before = { d, i: m.index };
        if (!first || m.index < first.i) first = { d, i: m.index };
        if (m[0].length === 0) g.lastIndex++;
      }
    }
  }
  const pick = before ?? first;
  return { actor: pick?.d ?? null, spans: pick ? spans : [] };
}

function resolveAor(text: string, actorSpans: [number, number][]): Aor {
  for (const [re, aor] of REGION_AOR) if (re.test(text)) return aor;
  // The mover's own name must not place the move: "Russia deploys bombers to
  // Venezuela" is a SOUTHCOM move.
  let stripped = "";
  let cursor = 0;
  for (const [s, e] of actorSpans.slice().sort((a, b) => a[0] - b[0])) {
    if (s < cursor) continue;
    stripped += text.slice(cursor, s) + " ";
    cursor = e;
  }
  stripped += text.slice(cursor);
  const a = aorFromName(stripped);
  return a !== "UNKNOWN" ? a : aorFromName(text);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Read the items for posture moves. Items older than 14 days are ignored. */
export function detectPostureMoves(items: NewsItem[], nowMs: number = Date.now()): PostureMove[] {
  const clusters = new Map<string, { move: PostureMove; sources: Set<string>; newest: number }>();
  for (const it of items) {
    const t = Date.parse(it.pubDate);
    if (!Number.isFinite(t) || nowMs - t > MAX_AGE_DAYS * DAY || t - nowMs > DAY) continue;
    const text = hay(it);
    if (!FORCE_NOUN.test(text)) continue;
    let found: { kind: MoveKind; index: number; phrase: string } | null = null;
    for (const kind of KIND_ORDER) {
      const m = firstMatch(text, kind);
      if (m) { found = { kind, ...m }; break; }
    }
    if (!found) continue;
    const { actor, spans } = resolveActor(text, found.index);
    const aor = resolveAor(text, spans);
    const actorName = actor?.name ?? "unattributed";
    const side: ActorSide = actor?.side ?? "other";
    const key = `${found.kind}|${slug(actorName)}|${aor}`;
    const src = (it.source || "").trim() || "unknown";
    const c = clusters.get(key);
    if (c) {
      c.sources.add(src);
      if (t > c.newest) { c.newest = t; c.move.headline = it.title; c.move.link = it.link; c.move.source = src; c.move.pubDate = it.pubDate; c.move.phrase = found.phrase; }
    } else {
      clusters.set(key, {
        newest: t, sources: new Set([src]),
        move: {
          id: `pm-${key.replace(/\|/g, "-")}`, kind: found.kind, actor: actorName, side, aor,
          headline: it.title, link: it.link, source: src, pubDate: it.pubDate, sources: 1, corroborated: false,
          phrase: found.phrase, falsifier: FALSIFIER[found.kind],
        },
      });
    }
  }
  const out = [...clusters.values()].map((c) => ({ ...c.move, sources: c.sources.size, corroborated: c.sources.size >= 2 }));
  return sortMoves(out);
}

const SIDE_RANK: Record<ActorSide, number> = { adversary: 3, us: 3, ally: 2, other: 1 };
const KIND_RANK: Record<MoveKind, number> = { mobilize: 5, deploy: 5, surge: 5, reposition: 3, withdraw: 3, exercise: 1 };

/** Corroborated first, then consequence, then recency. */
export function sortMoves(moves: PostureMove[]): PostureMove[] {
  return moves.slice().sort((a, b) =>
    Number(b.corroborated) - Number(a.corroborated)
    || (SIDE_RANK[b.side] + KIND_RANK[b.kind]) - (SIDE_RANK[a.side] + KIND_RANK[a.kind])
    || (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
}

/** Merge two readings of the same world (the server's feed sweep and the
 *  client's own articles + newsletters): same (kind, actor, AOR) → one row,
 *  sources summed only when the lead source differs. */
export function mergePostureMoves(a: PostureMove[], b: PostureMove[]): PostureMove[] {
  const by = new Map<string, PostureMove>();
  for (const m of [...a, ...b]) {
    const key = `${m.kind}|${slug(m.actor)}|${m.aor}`;
    const prev = by.get(key);
    if (!prev) { by.set(key, { ...m }); continue; }
    const newer = (Date.parse(m.pubDate) || 0) > (Date.parse(prev.pubDate) || 0) ? m : prev;
    const sources = prev.source === m.source ? Math.max(prev.sources, m.sources) : prev.sources + m.sources;
    by.set(key, { ...newer, sources, corroborated: sources >= 2 });
  }
  return sortMoves([...by.values()]);
}

/** Newsletter bullets as items the detector can read — each bullet is its own
 *  "article" dated by the newsletter, attributed to the newsletter source. */
export function newsletterBulletsAsItems(newsletters: NewsletterSummary[]): NewsItem[] {
  const out: NewsItem[] = [];
  for (const n of newsletters) {
    (n.bullets ?? []).forEach((b, i) => {
      if (!b || b.length < 20) return;
      out.push({ id: `nl-${n.id}-${i}`, title: b, source: `newsletter · ${n.source}`, category: "newsletter", pubDate: n.date, summary: "", link: "" });
    });
  }
  return out;
}

/** The GDELT query the server sweep uses (lib/postureMovesAssemble). */
export const POSTURE_GDELT_QUERY =
  '(deploys OR deployed OR deployment OR "carrier strike group" OR reinforcements OR mobilizes OR mobilization OR "high alert" OR repositions OR withdraws) (troops OR warships OR bombers OR fighters OR forces OR carrier OR missiles)';
