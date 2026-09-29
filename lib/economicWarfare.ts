// Economic warfare — the instrument grammar and the actor register. PURE,
// client-safe, unit-tested. Dependency-free beyond lib/chokepointSignals
// (itself pure) and the aor/centroid data modules, so the Economy tab's client
// components can import it without dragging a feed into the bundle.
//
// The north star for the Economy tab is "understand and predict when the
// countries or AORs I track are engaging in economic warfare". That is an
// I&W problem whose organising unit is the ACTOR, not the instrument: the
// reader wants "Iran" as a row, with what Iran is doing (shipping, energy,
// sanctions, trade, finance, overflight) graded the way the chokepoint board
// grades interdiction — reported act > declared threat > analysis — and scored
// as an ANOMALY against that actor's own trailing baseline through the
// existing lib/warning.ts engine.
//
// Three disciplines carried over, stated here because they are load-bearing:
//   1. Nothing is scored by mention count. A text earns a read only when it
//      contains an instrument PHRASE ("seized a tanker", "cut gas supplies",
//      "added to the entity list"); a bare mention of the actor is nothing.
//   2. Modality is graded, never guessed. The same THREAT/ANALYSIS markers as
//      the chokepoint grammar, so a strait read and an energy read cannot
//      disagree about what "vows to" means.
//   3. Direction matters. "US imposes sanctions on Iran" mentions Iran and
//      contains a sanctions phrase, but Iran is the TARGET. `attribute()`
//      decides by/against before a read is credited to an actor; the U.S.
//      side of the sequence is kept as a counter-move, not folded into the
//      actor's own score.

import {
  gradeModality, hasPhrase, readInterdiction,
  type Modality, type InterdictionClass,
} from "./chokepointSignals";
import type { IndicatorDef, IndicatorObservation, ObservedState, WarningProblemDef } from "./warning";
import { aorFromCoords, aorFromName, type Aor } from "./aor";
import { countryCentroid } from "./countryCentroids";
import { CHOKEPOINTS } from "./chokepoints";

// ───────────────────────────── instruments ─────────────────────────────

export type Instrument = "shipping" | "energy" | "sanctions" | "trade" | "finance" | "overflight";

export const INSTRUMENTS: Instrument[] = ["shipping", "energy", "sanctions", "trade", "finance", "overflight"];

export interface InstrumentMeta {
  glyph: string;
  label: string;
  /** What a live signal on this instrument bears on for a mobility squadron. */
  affects: string;
  /** Relative weight within an actor's board. Shipping leads: it is an attack
   *  on the economic system itself, not leverage over it. */
  weight: number;
  falsifier: string;
  provenance: string;
}

export const INSTRUMENT_META: Record<Instrument, InstrumentMeta> = {
  shipping: {
    glyph: "⚓", label: "Shipping",
    affects: "sealift routing · fuel cost · war-risk premium",
    weight: 0.9,
    falsifier: "No reported seizure, strike, mining or closure attributable to the actor, corroborated by ≥2 sources, in a rolling 14-day window; AIS transits at the actor's chokepoints within their own normal.",
    provenance: "Open maritime-security reporting; the chokepoint board's graded read (act > threat > analysis).",
  },
  energy: {
    glyph: "⛽", label: "Energy",
    affects: "jet-fuel / sustainment cost · host-nation stress",
    weight: 0.8,
    falsifier: "No supply cut, export halt or pipeline/production lever reported as an act by the actor in 14 days; Brent within ±5% of its 30-day mean.",
    provenance: "IEA / OIES open reporting on energy as leverage; Grabo 'economic measures' indicator class.",
  },
  sanctions: {
    glyph: "⊘", label: "Sanctions / export controls",
    affects: "host-nation access · contractor & fuel supply chains",
    weight: 0.6,
    falsifier: "No new designation, export ban or entity-list action by the actor naming a watched country or U.S. interest in 14 days.",
    provenance: "CSIS / Atlantic Council open sanctions trackers; OFAC / BIS record for the U.S. side.",
  },
  trade: {
    glyph: "⇄", label: "Trade",
    affects: "critical-minerals & component supply · basing economics",
    weight: 0.6,
    falsifier: "No tariff, import ban, embargo or export restriction on strategic goods announced or enacted by the actor in 14 days.",
    provenance: "WTO / PIIE open trade-measure tracking; CSIS critical-minerals reporting.",
  },
  finance: {
    glyph: "¤", label: "Finance",
    affects: "host-nation solvency · dollar access for contracts",
    weight: 0.5,
    falsifier: "No payment-system exclusion, reserve seizure, capital control or de-dollarisation act by the actor in 14 days.",
    provenance: "Atlantic Council / CFR open financial-statecraft reporting.",
  },
  overflight: {
    glyph: "✈", label: "Overflight",
    affects: "routing · fuel planning · crew-duty day",
    weight: 0.5,
    falsifier: "No airspace closure, overflight denial or fee/permit lever by the actor in 14 days.",
    provenance: "DAIP / NOTAM open data; open reporting on overflight as leverage.",
  },
};

/** The counter-pressure indicator: U.S. regulatory actions NAMING the actor
 *  (Federal Register). It is on the actor's board because escalating pressure
 *  on an actor is the most reliable precursor of retaliation — the sequence
 *  the north star asks the tab to learn — but at a lower weight: it is
 *  something done TO them, not BY them. */
export const COUNTER_PRESSURE_ID = "counter_pressure";

export interface InstrumentRead {
  instrument: Instrument;
  /** The class of act within the instrument — "seizure", "supply cut", … */
  cls: string;
  modality: Modality;
  phrase: string;
  /** Points contributed after the modality discount (0-100 scale). */
  weight: number;
}

const MODALITY_FACTOR: Record<Modality, number> = { act: 1, threat: 0.45, analysis: 0.1 };

// Phrases per class, per instrument. PHRASES, never single words — "sanctions"
// alone appears in every wire story about any of these actors. Verb agreement
// covered both ways where it matters (the chokepoint grammar's lesson: a real
// event must not grade as something weaker because the subject was plural).
type ClassDef = { cls: string; weight: number; phrases: string[] };

const ENERGY: ClassDef[] = [
  { cls: "supply cut", weight: 90, phrases: [
    "cut gas supplies", "cut off gas", "cut off oil", "halted gas deliveries", "halted oil deliveries",
    "suspended gas deliveries", "suspended gas supplies", "suspended oil supplies", "stopped gas flows",
    "halted gas flows", "turned off the taps", "cut gas flows", "gas supplies were halted", "supply cut",
    "shut off gas", "shut off the gas",
  ] },
  { cls: "export halt", weight: 85, phrases: [
    "halted oil exports", "halted gas exports", "halt oil exports", "banned oil exports", "banned fuel exports",
    "suspended oil exports", "suspended crude exports", "oil embargo", "gas embargo", "export ban on oil",
    "export ban on fuel", "curbed oil exports", "restricted oil exports", "halted crude exports",
    "stopped oil exports", "cut oil exports", "cut gas exports", "cut crude exports", "oil weapon", "energy weapon",
  ] },
  { cls: "infrastructure", weight: 85, phrases: [
    "pipeline was sabotaged", "sabotaged the pipeline", "pipeline sabotage", "attacked the pipeline",
    "attack on the pipeline", "pipeline was attacked", "struck the refinery", "struck an oil facility",
    "attacked oil facilities", "attack on oil facilities", "drone struck the refinery", "refinery was hit",
    "oil facility was hit", "shut the pipeline", "pipeline shut", "closed the pipeline", "lng terminal was attacked",
  ] },
  { cls: "production lever", weight: 55, phrases: [
    "production cut", "output cut", "cut production", "cut output", "slashed output", "opec+ cut",
    "opec cut", "curbed production", "throttled production", "reduce oil output", "reduced oil output",
    "raise output", "flood the market",
  ] },
];

const SANCTIONS: ClassDef[] = [
  { cls: "secondary sanctions", weight: 85, phrases: ["secondary sanctions", "sanctions on third countries", "sanction third-country", "extraterritorial sanctions"] },
  { cls: "export control", weight: 80, phrases: [
    "export controls on", "export control on", "added to the entity list", "entity list", "banned exports of",
    "banned the export of", "ban on exports of", "export ban on", "export restrictions on", "restricted exports of",
    "restrict exports of", "licensing requirement", "export licences", "export licenses", "unreliable entity list",
  ] },
  { cls: "designation", weight: 70, phrases: [
    "imposed sanctions", "impose sanctions", "imposes sanctions", "imposing sanctions", "new sanctions on",
    "new sanctions against", "sanctions on", "sanctions against", "sanctioned the", "sanctioned a", "sanctions package",
    "designated as", "designates", "designated the", "blacklisted", "blacklists", "added to its sanctions list",
    "sanctions list", "asset freeze", "froze the assets", "frozen assets", "froze assets", "travel ban on",
  ] },
  { cls: "sanctions lift", weight: 30, phrases: ["lifted sanctions", "lift sanctions", "sanctions relief", "eased sanctions", "sanctions waiver"] },
];

const TRADE: ClassDef[] = [
  { cls: "embargo", weight: 90, phrases: ["trade embargo", "full embargo", "total embargo", "imposed an embargo", "impose an embargo", "embargo on"] },
  { cls: "mineral / component control", weight: 85, phrases: [
    "rare earth export", "rare-earth export", "rare earths export", "critical minerals export", "critical mineral export",
    "export curbs on rare", "export curbs on gallium", "gallium and germanium", "graphite export", "antimony export",
    "tungsten export", "lithium export", "restricted exports of rare", "banned the export of rare", "export controls on rare",
    "chip export", "semiconductor export", "export restrictions on chips",
  ] },
  { cls: "import ban", weight: 75, phrases: [
    "import ban", "banned imports", "ban on imports", "halted imports", "suspended imports", "blocked imports",
    "customs blockade", "customs ban", "boycott of", "boycotted", "halted purchases of", "stopped buying",
    "suspended purchases", "banned the import", "banned all imports",
  ] },
  { cls: "tariff", weight: 60, phrases: [
    "tariffs on", "tariff on", "imposed tariffs", "impose tariffs", "imposes tariffs", "retaliatory tariffs",
    "retaliatory duties", "raised tariffs", "raise tariffs", "hiked tariffs", "new tariffs", "anti-dumping duties",
    "antidumping duties", "countervailing duties", "quota on", "import quota", "suspended trade", "trade war",
  ] },
];

const FINANCE: ClassDef[] = [
  { cls: "payment-system exclusion", weight: 85, phrases: [
    "cut off from swift", "removed from swift", "swift ban", "banned from swift", "disconnected from swift",
    "dollar clearing", "blocked from dollar", "cut off from the dollar", "excluded from the payment system",
    "correspondent banking", "denied access to the financial system",
  ] },
  { cls: "reserves / assets", weight: 80, phrases: [
    "froze central bank", "frozen central bank", "central bank reserves", "seized reserves", "seize reserves",
    "confiscated assets", "confiscate assets", "seized assets", "seize assets", "immobilised assets", "immobilized assets",
    "sovereign assets", "expropriated", "expropriation", "nationalised", "nationalized",
  ] },
  { cls: "default / capital controls", weight: 65, phrases: [
    "debt default", "defaulted on", "default on its debt", "capital controls", "currency controls", "banned dollar",
    "dollar ban", "halted repayments", "suspended debt payments", "missed a bond payment", "restructure its debt",
  ] },
  { cls: "de-dollarisation", weight: 40, phrases: [
    "settled in yuan", "settle in yuan", "settled in rubles", "settled in roubles", "bypassing the dollar", "bypass the dollar",
    "de-dollarisation", "de-dollarization", "dedollarisation", "dedollarization", "brics currency", "local currency settlement",
    "in local currencies", "abandon the dollar", "ditch the dollar", "digital yuan for",
  ] },
];

const OVERFLIGHT: ClassDef[] = [
  { cls: "airspace closure", weight: 85, phrases: [
    "closed its airspace", "closed the airspace", "airspace closed", "airspace closure", "closing its airspace",
    "shut its airspace", "airspace ban", "banned from its airspace", "notam closing",
  ] },
  { cls: "overflight denial", weight: 75, phrases: [
    "overflight denied", "denied overflight", "overflight rights revoked", "revoked overflight", "overflight ban",
    "banned overflights", "banned flights", "overflight permission", "overflight clearance", "denied permission to overfly",
    "refused overflight", "suspended overflight",
  ] },
  { cls: "overflight fees / permits", weight: 45, phrases: [
    "overflight fees", "overflight charges", "overflight permit", "air navigation fees", "transit fees for aircraft",
  ] },
];

const GRAMMAR: Record<Exclude<Instrument, "shipping">, ClassDef[]> = {
  energy: ENERGY, sanctions: SANCTIONS, trade: TRADE, finance: FINANCE, overflight: OVERFLIGHT,
};

// Shipping reuses the chokepoint grammar wholesale so a strait read and an
// actor read grade identically. Its `airspace` class belongs to overflight.
const SHIPPING_CLASS_LABEL: Record<Exclude<InterdictionClass, "airspace">, string> = {
  strike: "strike on shipping", seizure: "seizure", mining: "mining", closure: "closure",
  rerouting: "rerouting", escort: "escort",
};

/** Every instrument read a text supports, strongest first (one per
 *  instrument). Null-safe: nothing instrument-shaped → empty. */
export function readInstruments(text: string): InstrumentRead[] {
  if (!text) return [];
  const modality = gradeModality(text);
  const out: InstrumentRead[] = [];

  const ship = readInterdiction(text);
  if (ship && ship.cls !== "airspace") {
    out.push({ instrument: "shipping", cls: SHIPPING_CLASS_LABEL[ship.cls], modality: ship.modality, phrase: ship.phrase, weight: ship.weight });
  }

  for (const inst of Object.keys(GRAMMAR) as (keyof typeof GRAMMAR)[]) {
    let best: InstrumentRead | null = null;
    for (const def of GRAMMAR[inst]) {
      const phrase = def.phrases.find((p) => hasPhrase(text, p));
      if (!phrase) continue;
      const weight = Math.round(def.weight * MODALITY_FACTOR[modality]);
      if (!best || weight > best.weight) best = { instrument: inst, cls: def.cls, modality, phrase, weight };
    }
    if (best) out.push(best);
  }
  // The DAIP-style airspace phrases live in the chokepoint grammar too; if the
  // overflight grammar missed but the interdiction read found "airspace", keep it.
  if (ship && ship.cls === "airspace" && !out.some((r) => r.instrument === "overflight")) {
    out.push({ instrument: "overflight", cls: "airspace closure", modality: ship.modality, phrase: ship.phrase, weight: ship.weight });
  }

  out.sort((a, b) => b.weight - a.weight);
  return out;
}

/** The strongest read, or null. */
export function readInstrument(text: string): InstrumentRead | null {
  return readInstruments(text)[0] ?? null;
}

// ───────────────────────────── actors ─────────────────────────────

export type ActorKind = "state" | "nonstate";

export interface Actor {
  id: string;                 // slug — the warning problem id is `econ-<id>`
  label: string;
  kind: ActorKind;
  aor: Aor;
  /** Countries this actor stands for (Federal Register countriesIn + FR
   *  counter-move attribution). A non-state actor lists its host. */
  countries: string[];
  /** Mention gate for free text. */
  terms: RegExp;
  /** Chokepoints where this actor is the presumed coercer — a graded act at
   *  that strait is credited to them by GEOGRAPHY (stated on the board). */
  chokepointIds: string[];
  /** Why this actor is on the board. */
  reason: string;
}

interface CuratedActor {
  id: string; label: string; kind: ActorKind; aor: Aor;
  countries: string[]; extraTerms: string[]; chokepointIds: string[];
  /** For a non-state actor: which tracked countries make it relevant. */
  triggerCountries?: string[];
}

const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Curated because the generic name+adjective gate misses the ways these
// actors are actually written about (Tehran / the IRGC / the Kremlin / Beijing).
const CURATED: CuratedActor[] = [
  { id: "iran", label: "Iran", kind: "state", aor: "CENTCOM", countries: ["Iran"], extraTerms: ["tehran", "irgc", "revolutionary guard"], chokepointIds: ["hormuz"] },
  { id: "russia", label: "Russia", kind: "state", aor: "EUCOM", countries: ["Russia"], extraTerms: ["moscow", "kremlin", "gazprom", "rosneft"], chokepointIds: ["russia-ovf", "bosphorus"] },
  { id: "china", label: "China", kind: "state", aor: "INDOPACOM", countries: ["China"], extraTerms: ["beijing", "prc", "mofcom", "chinese"], chokepointIds: ["taiwan", "malacca"] },
  { id: "north-korea", label: "North Korea", kind: "state", aor: "INDOPACOM", countries: ["North Korea"], extraTerms: ["pyongyang", "dprk"], chokepointIds: [] },
  { id: "venezuela", label: "Venezuela", kind: "state", aor: "SOUTHCOM", countries: ["Venezuela"], extraTerms: ["caracas", "maduro", "pdvsa"], chokepointIds: ["panama"] },
  { id: "turkey", label: "Turkey", kind: "state", aor: "EUCOM", countries: ["Turkey", "Türkiye"], extraTerms: ["ankara", "erdogan", "turkish"], chokepointIds: ["bosphorus"] },
  { id: "saudi-arabia", label: "Saudi Arabia", kind: "state", aor: "CENTCOM", countries: ["Saudi Arabia"], extraTerms: ["riyadh", "aramco", "saudi"], chokepointIds: [] },
  { id: "egypt", label: "Egypt", kind: "state", aor: "CENTCOM", countries: ["Egypt"], extraTerms: ["cairo", "egyptian"], chokepointIds: ["suez"] },
  { id: "houthis", label: "Houthis (Ansar Allah)", kind: "nonstate", aor: "CENTCOM", countries: ["Yemen"], extraTerms: ["houthi", "houthis", "ansar allah", "ansarallah", "sanaa"], chokepointIds: ["babelmandeb"], triggerCountries: ["Yemen", "Saudi Arabia", "Iran", "Israel", "Egypt"] },
];

/** Name + the common adjective forms, same suffix rule as regulatorySignals
 *  (a final "r" withholds "-ian": Niger ≠ Nigerian). */
function nameTerms(name: string): string[] {
  const n = name.trim();
  if (n.length < 3) return [];
  const base = n.toLowerCase();
  const suffixes = /r$/i.test(n) ? ["n", "ese", "i", "s"] : ["n", "ian", "ese", "i", "s"];
  return [base, ...suffixes.map((s) => base + s)];
}

function termsRegex(words: string[]): RegExp {
  const uniq = [...new Set(words.map((w) => w.toLowerCase().trim()).filter((w) => w.length >= 3))];
  return new RegExp(`(?<![\\p{L}\\p{N}])(${uniq.map(escapeRx).join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function aorForCountry(name: string): Aor {
  const c = countryCentroid(name);
  return c ? aorFromCoords(c[0], c[1]) : aorFromName(name);
}

export const MAX_ACTORS = 8;

/**
 * The actor register for a given tracking picture. State actors come from the
 * tracked countries (Mission Profile AOIs + watched countries + base host
 * nations, in that order — declaration order is priority order); curated
 * non-state actors join when one of their trigger countries is tracked.
 * Deduped, capped, never empty when anything is tracked. A country that
 * cannot be placed still gets a generic actor (name + adjective gate) so
 * nothing tracked goes unwatched.
 */
export function resolveActors(tracked: string[]): Actor[] {
  const seen = new Set<string>();
  const out: Actor[] = [];
  const trackedLower = new Set(tracked.map((t) => t.trim().toLowerCase()).filter(Boolean));

  for (const raw of tracked) {
    const name = raw.trim();
    if (!name) continue;
    const cur = CURATED.find((c) => c.kind === "state" && c.countries.some((k) => k.toLowerCase() === name.toLowerCase()));
    const id = cur ? cur.id : slug(name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (cur) {
      out.push({
        id: cur.id, label: cur.label, kind: "state", aor: cur.aor, countries: cur.countries,
        terms: termsRegex([...cur.countries.flatMap(nameTerms), ...cur.extraTerms]),
        chokepointIds: cur.chokepointIds, reason: "tracked country",
      });
    } else {
      out.push({
        id, label: name, kind: "state", aor: aorForCountry(name), countries: [name],
        terms: termsRegex(nameTerms(name)), chokepointIds: [], reason: "tracked country",
      });
    }
    if (out.length >= MAX_ACTORS) return out;
  }

  for (const cur of CURATED) {
    if (cur.kind !== "nonstate" || seen.has(cur.id)) continue;
    const trigger = (cur.triggerCountries ?? []).find((t) => trackedLower.has(t.toLowerCase()));
    if (!trigger) continue;
    seen.add(cur.id);
    out.push({
      id: cur.id, label: cur.label, kind: "nonstate", aor: cur.aor, countries: cur.countries,
      terms: termsRegex([...cur.extraTerms]),
      chokepointIds: cur.chokepointIds, reason: `non-state actor in a tracked theatre (${trigger})`,
    });
    if (out.length >= MAX_ACTORS) break;
  }
  return out;
}

// ───────────────────────────── attribution ─────────────────────────────

export type Direction = "by" | "against";

// "… sanctions ON Iran", "tariffs AGAINST China", "targeting Iranian oil":
// the actor is the object of the measure. The preposition wins over word
// order because a headline routinely leads with the target ("Iran hit with
// new sanctions"). Extra words are tolerated between the preposition and the
// name ("sanctions on the Iranian oil sector") up to a short window.
const TARGET_PREP = "(?:on|against|targeting|targets|target|toward|towards|hit|hits|hitting|over|to punish|punishing|isolate|isolating|squeeze|squeezing)";
const PASSIVE_TAIL = "(?:hit with|hit by|faces|face|facing|slapped with|under new|subject to|targeted by|sanctioned by|threatened with)";

/** Is the actor the author of the measure in this text, or its object? Null
 *  when the actor is not mentioned at all. */
export function attribute(text: string, actor: Pick<Actor, "terms">): Direction | null {
  if (!text || !actor.terms.test(text)) return null;
  const src = actor.terms.source;
  // preposition … (≤3 words) … actor
  const asTarget = new RegExp(`\\b${TARGET_PREP}\\s+(?:\\S+\\s+){0,3}?${src}`, "iu");
  // actor … (≤2 words) … passive tail   ("Iran hit with sanctions")
  const asPassive = new RegExp(`${src}\\s+(?:\\S+\\s+){0,2}?${PASSIVE_TAIL}\\b`, "iu");
  if (asTarget.test(text) || asPassive.test(text)) return "against";
  return "by";
}

// Who is on the receiving end, for the coercion board's target column.
const TARGET_TERMS: [RegExp, string][] = [
  [/\b(commercial shipping|merchant (?:ship|vessel|fleet)|tankers?|container ships?|cargo ships?|bulk carriers?|vessels?)\b/i, "commercial shipping"],
  [/\b(united states|u\.s\.|us\b|american|washington|pentagon|white house)\b/i, "United States"],
  [/\b(european union|\beu\b|europe|european|brussels)\b/i, "Europe / EU"],
  [/\b(israel|israeli|tel aviv)\b/i, "Israel"],
  [/\b(ukraine|ukrainian|kyiv)\b/i, "Ukraine"],
  [/\b(taiwan|taipei)\b/i, "Taiwan"],
  [/\b(gulf states|\bgcc\b|saudi|emirates|\buae\b|qatar|bahrain|kuwait)\b/i, "Gulf states"],
  [/\b(japan|japanese|tokyo|south korea|seoul|philippines|manila|australia|canberra)\b/i, "Indo-Pacific partners"],
  [/\b(nato|the west|western)\b/i, "NATO / the West"],
];

export function targetOf(text: string, instrument: Instrument, actor: Pick<Actor, "terms">): string {
  const stripped = text.replace(actor.terms, " ");
  for (const [rx, label] of TARGET_TERMS) {
    if (instrument !== "shipping" && label === "commercial shipping") continue;
    if (rx.test(stripped)) return label;
  }
  return instrument === "shipping" ? "commercial shipping" : "—";
}

// ───────────────────────────── the actor board ─────────────────────────────

export const ECON_PROBLEM_PREFIX = "econ-";
export const econProblemId = (actorId: string): string => `${ECON_PROBLEM_PREFIX}${actorId}`;

/** A readable label for a stored problem id (the OE delta reads
 *  warning_daily for every id, including ours). */
export function econProblemLabel(problemId: string): string | null {
  if (!problemId.startsWith(ECON_PROBLEM_PREFIX)) return null;
  const id = problemId.slice(ECON_PROBLEM_PREFIX.length);
  const cur = CURATED.find((c) => c.id === id);
  const name = cur ? cur.label : id.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return `Economic warfare · ${name}`;
}

export const ECON_THRESHOLDS = { watch: 0.15, warning: 0.35, alert: 0.6 };

/** The per-actor warning problem — one indicator per instrument plus the
 *  counter-pressure indicator. Same engine, thresholds and learning-mode
 *  rule as the OSINT I&W boards; a fresh actor id starts with no history and
 *  is held at Watch until a real baseline forms. */
export function actorProblem(actor: Actor): WarningProblemDef {
  const id = econProblemId(actor.id);
  const cps = actor.chokepointIds.map((cid) => CHOKEPOINTS.find((c) => c.id === cid)?.name ?? cid);
  const indicators: IndicatorDef[] = INSTRUMENTS.map((inst) => {
    const m = INSTRUMENT_META[inst];
    return {
      id: inst, warningProblem: id,
      description: `${m.label} as an instrument of coercion by ${actor.label}${inst === "shipping" && cps.length ? ` (graded reads at ${cps.join(", ")} credited by geography)` : ""} — reported act > declared threat > analysis.`,
      sourceFeed: inst === "shipping"
        ? "GDELT DOC actor query + the chokepoint board's graded read + AIS transits; corroborated by your X / newsletters / captured articles / OSINT feeds"
        : "GDELT DOC actor query; corroborated by your X / newsletters / captured articles / OSINT feeds",
      weight: m.weight,
      falsifier: m.falsifier,
      provenance: m.provenance,
    };
  });
  indicators.push({
    id: COUNTER_PRESSURE_ID, warningProblem: id,
    description: `U.S. sanctions / export-control / tariff actions naming ${actor.label} in the Federal Register — pressure that precedes retaliation.`,
    sourceFeed: "Federal Register API (OFAC · BIS · USTR · presidential documents), 45-day window",
    weight: 0.4,
    falsifier: `No Federal Register action naming ${actor.label} in the last 14 days.`,
    provenance: "Federal Register public record; open sanctions-and-retaliation sequence literature (CSIS, Atlantic Council).",
  });
  return {
    id,
    label: `Economic warfare · ${actor.label}`,
    scenario: `${actor.label} uses economic leverage (${INSTRUMENTS.map((i) => INSTRUMENT_META[i].label.toLowerCase()).join(", ")}) or attacks the economic system itself, in a way that changes fuel cost, sealift routing, overflight or host-nation access for the force.`,
    decisionLinkage: "A threshold crossing informs: (1) fuel-cost and routing assumptions in the next planning cycle; (2) sealift / tanker sequencing through the actor's chokepoints; (3) host-nation access and contract-supply risk at bases in the affected theatre.",
    thresholds: { ...ECON_THRESHOLDS },
    indicators,
  };
}

// ───────────────────────────── state mapping ─────────────────────────────

export interface GradedEvidence {
  modality: Modality;
  /** Own-source (X / newsletter / captured article / OSINT feed) rather than wire. */
  own: boolean;
  /** Distinct source label, for the ≥2-sources corroboration rule. */
  source: string;
}

/**
 * Fold an instrument's graded evidence into an observed state. The same
 * ladder as the chokepoint indicator (warningRules.chokepointState):
 *   reported act (wire)              → active; confirmed when ≥2 distinct
 *                                       wire sources or an own-source agrees
 *   declared threat (wire)           → watching; active with own-source agreement
 *   analysis only, ≥2 pieces         → watching (low confidence)
 *   own-source only                  → watching — CAPS there, whatever it says
 *   nothing                          → dormant
 * An own-source ACT with no wire never passes watching: social raises
 * confidence, it does not alone confirm.
 */
export function instrumentState(evidence: GradedEvidence[]): { state: ObservedState; confidence: number; why: string } {
  const wire = evidence.filter((e) => !e.own);
  const own = evidence.filter((e) => e.own);
  const wireActs = wire.filter((e) => e.modality === "act");
  const wireThreats = wire.filter((e) => e.modality === "threat");
  const wireAnalysis = wire.filter((e) => e.modality === "analysis");
  const ownAgrees = own.some((e) => e.modality !== "analysis");
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;

  if (wireActs.length >= 1) {
    const sources = new Set(wireActs.map((e) => e.source)).size;
    if (ownAgrees) return { state: "confirmed", confidence: 0.85, why: `${n(wireActs.length, "reported act")}, corroborated by your sources` };
    if (sources >= 2) return { state: "confirmed", confidence: 0.8, why: `${n(wireActs.length, "reported act")} across ${sources} sources` };
    return { state: "active", confidence: 0.7, why: n(wireActs.length, "reported act") };
  }
  if (wireThreats.length >= 1) {
    return ownAgrees
      ? { state: "active", confidence: 0.6, why: `${n(wireThreats.length, "declared threat")}, corroborated by your sources` }
      : { state: "watching", confidence: 0.55, why: n(wireThreats.length, "declared threat") };
  }
  if (own.length >= 1 && ownAgrees) return { state: "watching", confidence: 0.45, why: "own sources only" };
  if (wireAnalysis.length >= 2) return { state: "watching", confidence: 0.3, why: `${n(wireAnalysis.length, "analysis piece")}, no reported act or threat` };
  return { state: "dormant", confidence: 0, why: "nothing instrument-shaped reported" };
}

/** The counter-pressure state from Federal Register actions naming the actor.
 *  Recency is the whole signal: a 40-day-old designation is the standing
 *  sanctions regime, not new pressure. */
export function counterPressureState(ages: number[]): { state: ObservedState; confidence: number; why: string } {
  const recent = ages.filter((a) => a <= 14);
  const week = recent.filter((a) => a <= 7);
  if (week.length >= 2) return { state: "active", confidence: 0.7, why: `${week.length} U.S. actions naming the actor in 7 days` };
  if (recent.length >= 1) return { state: "watching", confidence: 0.55, why: `${recent.length} U.S. action${recent.length === 1 ? "" : "s"} naming the actor in 14 days` };
  if (ages.length >= 1) return { state: "dormant", confidence: 0, why: `standing regime only (last action ${Math.min(...ages)}d ago)` };
  return { state: "dormant", confidence: 0, why: "no U.S. action naming the actor in the window" };
}

/** Build one observation. `ts` is passed in — no Date.now() in a pure fn. */
export function observation(indicatorId: string, sensorId: string, s: { state: ObservedState; confidence: number; why: string }, ts: string, provenance: string, magnitude?: number): IndicatorObservation {
  return { sensorId, indicatorId, observedState: s.state, confidence: s.confidence, magnitude, ts, provenance: `${provenance} — ${s.why}` };
}

// ───────────────────────────── the coercion board ─────────────────────────────

export interface CoercionMove {
  id: string;
  actorId: string;
  actorLabel: string;
  /** "by": the actor did/threatened it. "against": done to the actor (U.S.
   *  counter-move from the Federal Register, or a text where the actor is the
   *  object). */
  direction: Direction;
  target: string;
  instrument: Instrument;
  cls: string;
  modality: Modality;
  weight: number;
  title: string;
  link?: string;
  source?: string;
  pubDate?: string;
  ageDays: number | null;
  own: boolean;
  phrase: string;
}

const MODALITY_RANK: Record<Modality, number> = { act: 2, threat: 1, analysis: 0 };

/** Rank moves for the board: acts before threats before analysis; within a
 *  modality by weight, then freshest. Undated rows sort after dated ones of
 *  the same weight. */
export function rankMoves(moves: CoercionMove[]): CoercionMove[] {
  return [...moves].sort((a, b) =>
    MODALITY_RANK[b.modality] - MODALITY_RANK[a.modality]
    || b.weight - a.weight
    || (a.ageDays ?? 9999) - (b.ageDays ?? 9999)
    || a.title.localeCompare(b.title));
}

export function ageDaysOf(pubDate: string | undefined, todayMs: number): number | null {
  if (!pubDate) return null;
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((todayMs - t) / 86_400_000));
}

/** Days of text considered on the board. Older reads are the baseline's
 *  business, not today's picture. */
export const TEXT_WINDOW_DAYS = 14;

export interface ActorText {
  title: string;
  summary?: string;
  link?: string;
  source?: string;
  pubDate?: string;
  own: boolean;
}

/** Grade an actor's texts into moves (by AND against). A text with no
 *  instrument phrase produces nothing; one with several yields one move per
 *  instrument, so a headline about "sanctions in retaliation for the tanker
 *  seizure" lands on both rows it belongs to. Dedupes by link, then title. */
export function movesFor(actor: Actor, texts: ActorText[], todayMs: number): CoercionMove[] {
  const out: CoercionMove[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    const text = `${t.title} ${t.summary ?? ""}`;
    const key = (t.link || t.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const ageDays = ageDaysOf(t.pubDate, todayMs);
    if (ageDays != null && ageDays > TEXT_WINDOW_DAYS) continue;
    const dir = attribute(text, actor);
    if (!dir) continue;
    const reads = readInstruments(text);
    if (reads.length === 0) continue;
    seen.add(key);
    for (const r of reads) {
      out.push({
        id: `${actor.id}:${r.instrument}:${key.slice(0, 80)}`,
        actorId: actor.id, actorLabel: actor.label,
        direction: dir,
        target: dir === "by" ? targetOf(text, r.instrument, actor) : actor.label,
        instrument: r.instrument, cls: r.cls, modality: r.modality, weight: r.weight,
        title: t.title, link: t.link, source: t.source, pubDate: t.pubDate,
        ageDays, own: t.own, phrase: r.phrase,
      });
    }
  }
  return out;
}

/** Evidence per instrument from the actor's OWN moves (direction "by"). */
export function evidenceByInstrument(moves: CoercionMove[]): Record<Instrument, GradedEvidence[]> {
  const out = Object.fromEntries(INSTRUMENTS.map((i) => [i, [] as GradedEvidence[]])) as Record<Instrument, GradedEvidence[]>;
  for (const m of moves) {
    if (m.direction !== "by") continue;
    out[m.instrument].push({ modality: m.modality, own: m.own, source: (m.source ?? "").toLowerCase() || m.title.slice(0, 40) });
  }
  return out;
}

/** Map a Federal Register class to the instrument it plays on. */
export function instrumentForRegulatoryClass(cls: string): Instrument {
  if (cls === "tariff") return "trade";
  return "sanctions";
}
