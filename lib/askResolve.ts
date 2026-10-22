// "Ask the board" — the question's ENTITIES and SHAPE. PURE, client-safe,
// unit-tested (docs/PLAN-SPACE-CYBER-ASK.md §4.3 step 1).
//
// A question like "how likely is conflict with Iran" or "what indicators
// show Russia positioning for war" is resolved to the surfaces the app
// already keeps about those actors — boards, posture rows, straits, the
// economy tile — before any model sees it. Unresolved → the ordinary
// assistant answers and says what it could not place. The shape flags
// (warning-shaped, wants a probability, wants the indicators) drive the
// auto-route on the client and the answer contract on the server.

import type { Aor } from "./aor";

export interface AskCatalogue {
  boards: { id: string; label: string; countries: string[]; aor: Aor; chokepointId: string | null; spacePowers: string[] }[];
  chokepoints: { id: string; name: string; keywords: string[] }[];
  /** Every country name the app knows (lib/countryNames knownCountryNames). */
  countries: string[];
}

export interface AskResolution {
  countries: string[];
  aors: Aor[];
  boardIds: string[];
  chokepointIds: string[];
  /** Economy actor ids the question names (lib/economicWarfare curated ids). */
  actorIds: string[];
  warningShaped: boolean;
  wantsProbability: boolean;
  wantsIndicators: boolean;
  /** Domains the question leans on, for pack ordering. */
  topics: ("space" | "cyber" | "economy" | "posture" | "weather" | "demand")[];
  /** What the question named that the app could not place. */
  unplaced: string[];
}

const escRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names the wires use for the states the app watches most — the question
 *  says "Tehran" or "the Kremlin" as often as the country. */
const ACTOR_ALIASES: Record<string, string> = {
  // The bare names of the states the boards watch most, so a lowercase
  // question still places them.
  iran: "Iran", iraq: "Iraq", russia: "Russia", china: "China", israel: "Israel", ukraine: "Ukraine", yemen: "Yemen",
  syria: "Syria", taiwan: "Taiwan", poland: "Poland", germany: "Germany", jordan: "Jordan", turkey: "Turkey", "north korea": "North Korea",
  venezuela: "Venezuela", lebanon: "Lebanon",
  tehran: "Iran", irgc: "Iran", "revolutionary guard": "Iran", "islamic republic": "Iran", iranian: "Iran", iranians: "Iran",
  kremlin: "Russia", moscow: "Russia", putin: "Russia", russian: "Russia", russians: "Russia",
  beijing: "China", prc: "China", pla: "China", chinese: "China", xi: "China",
  pyongyang: "North Korea", dprk: "North Korea", "north korean": "North Korea",
  houthi: "Yemen", houthis: "Yemen", hezbollah: "Lebanon", hamas: "Israel", taipei: "Taiwan", taiwanese: "Taiwan",
  israeli: "Israel", saudi: "Saudi Arabia", emirati: "United Arab Emirates", ukrainian: "Ukraine", kyiv: "Ukraine",
  syrian: "Syria", iraqi: "Iraq", jordanian: "Jordan", turkish: "Turkey", ankara: "Turkey", polish: "Poland", german: "Germany",
};
const ECONOMY_ACTORS: Record<string, string> = { Iran: "iran", Russia: "russia", China: "china", "North Korea": "north-korea", Venezuela: "venezuela", Turkey: "turkey", Yemen: "houthis" };

const AOR_TERMS: [RegExp, Aor][] = [
  [/\b(centcom|central command|middle east|the gulf|persian gulf|arabian gulf|levant)\b/i, "CENTCOM"],
  [/\b(eucom|european command|europe|nato|baltics?|black sea)\b/i, "EUCOM"],
  [/\b(indopacom|indo-?pacific|pacific|south china sea|first island chain)\b/i, "INDOPACOM"],
  [/\b(africom|africa|sahel|horn of africa)\b/i, "AFRICOM"],
  [/\b(southcom|southern command|latin america|caribbean)\b/i, "SOUTHCOM"],
  [/\b(northcom|northern command|homeland|conus)\b/i, "NORTHCOM"],
];

const WARNING_VERBS = /\b(likely|likelihood|probability|probable|odds|chance|risk of|indicators?|warning|positioning|posturing|preparing|prepar(?:e|es|ed|ation)|escalat(?:e|es|ing|ion)|mobili[sz](?:e|es|ing|ation)|imminent|invasion|invade|attack|strike|conflict|war\b|hostilit|build-?up|surge|threat)/i;
const PROBABILITY = /\b(how likely|likelihood|probability|probable|odds|chance|percent|%|what are the odds)\b/i;
const INDICATORS = /\b(indicators?|signals?|evidence|what (?:are you|is the board|do you) see(?:ing)?|why (?:is|does)|drivers?|what changed|what moved)\b/i;

const TOPIC_RX: [RegExp, AskResolution["topics"][number]][] = [
  [/\b(space|satellite|orbit|counterspace|inspector|kosmos|cosmos|asat|jamming)\b/i, "space"],
  [/\b(cyber|hack|ransomware|intrusion|malware|ddos|pre-?position)\b/i, "cyber"],
  [/\b(sanction|tariff|export control|chokepoint|strait|hormuz|shipping|oil|energy|economic)\b/i, "economy"],
  [/\b(posture|posturing|positioning|forces?|troops?|deploy\w*|mobili[sz]\w*|exercises?|bases?|airfields?)\b/i, "posture"],
  [/\b(weather|taf|metar|storm|wind)\b/i, "weather"],
  [/\b(demand|airlift|lift|crews?|tasking|hadr|neo|evacuat)\b/i, "demand"],
];

/** The client's auto-route test: a warning verb and (ideally) a proper
 *  noun. Cheap, no catalogue; the server resolves properly. */
export function isWarningShaped(question: string): boolean {
  const q = question.trim();
  if (q.length < 8) return false;
  return WARNING_VERBS.test(q) && (/[A-Z][a-z]{2,}/.test(q) || Object.keys(ACTOR_ALIASES).some((a) => new RegExp(`\\b${escRx(a)}\\b`, "i").test(q)));
}

export function resolveAsk(question: string, cat: AskCatalogue): AskResolution {
  const q = question.trim();
  const low = q.toLowerCase();
  const countries = new Set<string>();
  // Country names (longest first so "North Korea" beats "Korea").
  for (const c of [...cat.countries].sort((a, b) => b.length - a.length)) {
    if (c.length < 4) continue;
    if (new RegExp(`\\b${escRx(c)}\\b`, "i").test(q)) countries.add(c);
  }
  for (const [alias, country] of Object.entries(ACTOR_ALIASES)) {
    if (new RegExp(`\\b${escRx(alias)}\\b`, "i").test(q)) countries.add(country);
  }
  const aors = new Set<Aor>();
  for (const [rx, aor] of AOR_TERMS) if (rx.test(q)) aors.add(aor);
  const chokepointIds = new Set<string>();
  for (const cp of cat.chokepoints) if (cp.keywords.some((k) => low.includes(k.toLowerCase()))) chokepointIds.add(cp.id);

  // Boards: by named country, by AOR, by the strait they watch; a question
  // about a country with no board still gets its posture row.
  const boardIds = new Set<string>();
  for (const b of cat.boards) {
    const byCountry = b.countries.some((c) => countries.has(c));
    const byAor = aors.has(b.aor) && countries.size === 0;
    const byStrait = b.chokepointId != null && chokepointIds.has(b.chokepointId);
    const byLabel = new RegExp(`\\b${escRx(b.label.split(" · ").pop() ?? b.label)}\\b`, "i").test(q);
    if (byCountry || byAor || byStrait || byLabel) boardIds.add(b.id);
  }
  for (const b of cat.boards) if (boardIds.has(b.id)) aors.add(b.aor);

  const actorIds = new Set<string>();
  for (const c of countries) { const id = ECONOMY_ACTORS[c]; if (id) actorIds.add(id); }

  const topics: AskResolution["topics"] = [];
  for (const [rx, t] of TOPIC_RX) if (rx.test(q) && !topics.includes(t)) topics.push(t);

  // Proper nouns the app could not place (capitalised words that are not a
  // sentence start and matched nothing) — said back, never guessed.
  const unplaced: string[] = [];
  const words = q.match(/\b[A-Z][a-zA-Z-]{3,}\b/g) ?? [];
  for (const w of words) {
    if (q.startsWith(w)) continue;                       // the sentence's first word is capitalised for free
    const lw = w.toLowerCase();
    if ([...countries].some((c) => c.toLowerCase().includes(lw)) || ACTOR_ALIASES[lw] || /^(What|How|Which|When|Where|Should|Could|Would|Does|Is|Are|Will|Can|Tell|Show|Give|The|And|For)$/i.test(w)) continue;
    if (AOR_TERMS.some(([rx]) => rx.test(w))) continue;
    if (!unplaced.includes(w)) unplaced.push(w);
  }

  return {
    countries: [...countries], aors: [...aors], boardIds: [...boardIds], chokepointIds: [...chokepointIds], actorIds: [...actorIds],
    warningShaped: WARNING_VERBS.test(q), wantsProbability: PROBABILITY.test(q), wantsIndicators: INDICATORS.test(q),
    topics, unplaced: unplaced.slice(0, 5),
  };
}

/** The cache key half that is the question: lower-cased, punctuation
 *  stripped, whitespace collapsed. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}
