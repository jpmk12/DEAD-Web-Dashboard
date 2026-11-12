// PROPOSED THEMES — themes the app suggests from what you declared, checked
// against what your own sources actually say. PURE, client-safe, no model
// call; tested in tests/themeProposals.test.ts.
//
// Two steps:
//
//   1. SEEDS from the declaration (`profileSeeds`): your hub and spokes, the
//      ★ fields and countries, the countries of every area of interest, the
//      chokepoints those areas carry, the watchlist and priority topics. Each
//      seed is a draft name and the names the thing goes by (a field's ICAO
//      and short name; a country's demonym, capital and the actors written
//      about in its place — IRGC, Kremlin, PLA; a strait's keywords).
//
//   2. EVIDENCE (`proposeThemes`): every seed is read against the stored
//      14-day own-source pool. A seed is proposed only when it would have
//      matched ≥ PROPOSE_MIN_ITEMS items from ≥ PROPOSE_MIN_SOURCES distinct
//      sources and no theme you already have catches most of those items.
//      The phrases that name nothing are dropped; up to PROPOSE_MAX_ADDS
//      terms far likelier in its items than in the rest of the pool are
//      added (the suggested-phrase rule). A seed whose items share a cluster
//      of such terms that mostly appear in its context ("Azraq", "Tower 22")
//      also yields a NARROWER proposal made of that cluster — a theme is an
//      OR of phrases, so a narrower theme must be built from terms specific
//      enough to stand alone.
//
// Disciplines: every proposal states its evidence; a declined proposal is
// never proposed again (`dismissKey`, shared); nothing here creates a theme —
// the crew's tap does; interest (what you open) only orders, never admits.

import { candidateTerms, type TuneRow } from "./themeTuning";
import { themeRegex, maskExclusions, normalizePhrases, validateThemeDraft, THEME_MAX_PHRASES, THEME_NAME_MAX, type Theme, type ThemeSourceKind } from "./themes";
import { CHOKEPOINTS } from "./chokepoints";

export const PROPOSE_MIN_ITEMS = 5;
export const PROPOSE_MIN_SOURCES = 2;
/** A proposal is dropped when one theme you have already catches more than this share of its items. */
export const PROPOSE_MAX_OVERLAP = 0.5;
/** Two proposals sharing more than this share of items: only the stronger is shown. */
export const PROPOSE_DEDUPE_OVERLAP = 0.8;
export const PROPOSE_MAX = 6;
export const PROPOSE_MAX_ADDS = 3;
const LIFT_MIN = 4;
/** A term joins a cluster when this share of its items already name a member. */
const CLUSTER_SHARE = 0.3;

export type SeedOrigin = "hub" | "spoke" | "star-field" | "star-country" | "aoi-country" | "chokepoint" | "watchlist" | "topic";

export interface ThemeSeed {
  /** Stable key: origin + the declared thing ("hub:OJAQ", "country:jordan"). */
  key: string;
  name: string;
  phrases: string[];
  origin: SeedOrigin;
  /** Where it came from, in words: "your hub OJAQ", "area of interest “Iran & Hormuz”". */
  label: string;
  /** Declaration weight — orders proposals, never admits one. */
  weight: number;
  /** Open-tracking ids this seed is about ("country:jordan", "base:ojaq"). */
  interest: string[];
}

export interface SeedInput {
  hub?: { icao: string; label: string; country?: string } | null;
  spokes?: { icao: string; label: string; country?: string }[];
  /** ★ airfields (label when the app knows one). */
  starFields?: { icao: string; label?: string }[];
  starCountries?: string[];
  aois?: { name: string; intensity: "primary" | "watch"; countries: string[]; chokepointIds: string[] }[];
  watchlist?: string[];
  topics?: string[];
}

// The other names a country is written about by — demonym, capital, and the
// actors reported in its place. Matched word-bounded through the theme grammar.
export const COUNTRY_ALIASES: Record<string, string[]> = {
  iran: ["Iranian", "Tehran", "IRGC", "Islamic Republic"],
  iraq: ["Iraqi", "Baghdad", "Erbil"],
  syria: ["Syrian", "Damascus"],
  jordan: ["Jordanian", "Amman"],
  israel: ["Israeli", "IDF", "Tel Aviv"],
  lebanon: ["Lebanese", "Beirut", "Hezbollah"],
  yemen: ["Yemeni", "Houthi", "Houthis", "Sanaa"],
  "saudi arabia": ["Saudi", "Riyadh"],
  "united arab emirates": ["UAE", "Emirati", "Abu Dhabi"],
  qatar: ["Qatari", "Doha"],
  kuwait: ["Kuwaiti"],
  bahrain: ["Bahraini", "Manama"],
  oman: ["Omani", "Muscat"],
  egypt: ["Egyptian", "Cairo"],
  turkey: ["Turkish", "Türkiye", "Ankara"],
  russia: ["Russian", "Kremlin", "Moscow"],
  ukraine: ["Ukrainian", "Kyiv"],
  belarus: ["Belarusian", "Minsk"],
  china: ["Chinese", "Beijing", "PLA", "PRC"],
  taiwan: ["Taiwanese", "Taipei"],
  "north korea": ["North Korean", "DPRK", "Pyongyang"],
  "south korea": ["South Korean", "Seoul"],
  japan: ["Japanese", "Tokyo"],
  philippines: ["Philippine", "Filipino", "Manila"],
  pakistan: ["Pakistani", "Islamabad"],
  afghanistan: ["Afghan", "Kabul", "Taliban"],
  india: ["Indian", "New Delhi"],
  poland: ["Polish", "Warsaw"],
  germany: ["German", "Berlin"],
  venezuela: ["Venezuelan", "Caracas", "Maduro"],
  cuba: ["Cuban", "Havana"],
  libya: ["Libyan", "Tripoli", "Benghazi"],
  sudan: ["Sudanese", "Khartoum", "RSF"],
  somalia: ["Somali", "Mogadishu", "al-Shabaab"],
  djibouti: ["Djiboutian"],
  niger: ["Niamey"],
  mali: ["Malian", "Bamako"],
};

/** "Muwaffaq Salti AB, Jordan" → "Muwaffaq Salti" (the name a post uses). */
export function fieldShortName(label: string): string {
  return label.replace(/\s*,.*$/, "").replace(/\([^)]*\)/g, "")
    .replace(/\b(?:AFB|AB|JB|NAS|NS|RAF|Field|Intl|International|Airport|Air Base|Airbase|Air Station)\b/g, "")
    .replace(/\s+/g, " ").trim();
}

const clipName = (s: string) => (s.length > THEME_NAME_MAX ? `${s.slice(0, THEME_NAME_MAX - 1).trimEnd()}…` : s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WEIGHT: Record<SeedOrigin, number> = {
  hub: 40, spoke: 30, "star-field": 28, "star-country": 25, "aoi-country": 18, chokepoint: 18, watchlist: 10, topic: 8,
};

/** The declaration → seeds, one per declared thing, deduped by key. */
export function profileSeeds(input: SeedInput): ThemeSeed[] {
  const out = new Map<string, ThemeSeed>();
  const put = (s: ThemeSeed) => {
    const prev = out.get(s.key);
    if (!prev) { out.set(s.key, s); return; }
    // The same thing declared twice: keep the stronger origin, remember both.
    if (s.weight > prev.weight) out.set(s.key, { ...s, label: `${s.label} · ${prev.label}` });
    else prev.label = prev.label.includes(s.label) ? prev.label : `${prev.label} · ${s.label}`;
  };

  const field = (f: { icao: string; label?: string }, origin: SeedOrigin, label: string) => {
    const icao = f.icao.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(icao)) return;
    const short = f.label ? fieldShortName(f.label) : "";
    const phrases = normalizePhrases([icao, short].filter(Boolean));
    put({
      key: `field:${icao}`, name: clipName(short ? `${icao} · ${short}` : icao), phrases, origin, label, weight: WEIGHT[origin],
      interest: [`base:${icao.toLowerCase()}`],
    });
  };
  if (input.hub?.icao) field(input.hub, "hub", `your hub ${input.hub.icao.toUpperCase()}`);
  for (const s of input.spokes ?? []) field(s, "spoke", `your spoke ${s.icao.toUpperCase()}`);
  for (const s of input.starFields ?? []) field(s, "star-field", `★ field ${s.icao.toUpperCase()}`);

  const country = (name: string, origin: SeedOrigin, label: string, weight = WEIGHT[origin]) => {
    const n = name.trim();
    if (!n) return;
    const k = n.toLowerCase();
    const phrases = normalizePhrases([n, ...(COUNTRY_ALIASES[k] ?? [])]).slice(0, THEME_MAX_PHRASES);
    put({ key: `country:${k}`, name: clipName(n), phrases, origin, label, weight, interest: [`country:${k}`] });
  };
  for (const c of input.starCountries ?? []) country(c, "star-country", `★ country`);
  for (const a of input.aois ?? []) {
    const w = WEIGHT["aoi-country"] + (a.intensity === "primary" ? 6 : 0);
    for (const c of a.countries) country(c, "aoi-country", `area of interest “${a.name}”`, w);
    for (const id of a.chokepointIds) {
      const cp = CHOKEPOINTS.find((x) => x.id === id);
      if (!cp) continue;
      const phrases = normalizePhrases([cp.name.replace(/\s*\(.*\)$/, "").split(" / ")[0], ...cp.keywords]).slice(0, THEME_MAX_PHRASES);
      put({ key: `chokepoint:${cp.id}`, name: clipName(cp.name), phrases, origin: "chokepoint", label: `chokepoint in “${a.name}”`, weight: WEIGHT.chokepoint + (a.intensity === "primary" ? 4 : 0), interest: [] });
    }
  }
  for (const w of input.watchlist ?? []) {
    const t = w.trim();
    if (t.length < 3) continue;
    put({ key: `term:${t.toLowerCase()}`, name: clipName(cap(t)), phrases: normalizePhrases([t]), origin: "watchlist", label: "your watchlist", weight: WEIGHT.watchlist, interest: [] });
  }
  for (const w of input.topics ?? []) {
    const t = w.trim();
    if (t.length < 3) continue;
    put({ key: `term:${t.toLowerCase()}`, name: clipName(cap(t)), phrases: normalizePhrases([t]), origin: "topic", label: "your priority topics", weight: WEIGHT.topic, interest: [] });
  }
  return [...out.values()].filter((s) => s.phrases.length > 0);
}

// ── Evidence ─────────────────────────────────────────────────────────────

export interface ProposalSample { id: string; title: string; source: string; link: string; pubDate: string }

export interface ThemeProposal {
  /** Stable — also the dismissal key. "seed:<seed key>" or "narrow:<seed key>:<terms>". */
  key: string;
  kind: "seed" | "narrow";
  name: string;
  phrases: string[];
  origin: SeedOrigin;
  originLabel: string;
  items: number;
  sources: number;
  byKind: Partial<Record<ThemeSourceKind, number>>;
  /** Declared phrases that named nothing in the window — left out, said. */
  droppedPhrases: string[];
  /** Terms added from the evidence, each with its reason. */
  added: { term: string; why: string }[];
  /** The existing theme sharing most items, when any shares some. */
  overlap: { theme: string; share: number } | null;
  why: string;
  samples: ProposalSample[];
  score: number;
}

export interface ProposeResult {
  proposals: ThemeProposal[];
  /** Seeds read, and why each one that did not become a proposal was left out. */
  considered: number;
  skipped: { key: string; name: string; reason: string }[];
  note: string | null;
}

export interface ProposeOpts {
  dismissed?: Set<string>;
  /** Open-tracking boosts keyed by "surface:id" (lower-case), from openBoosts. */
  boosts?: Record<string, number>;
  max?: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const keyOf = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

/** True when a term is one of the phrases, a phrase is inside it, or it is inside a phrase. */
function covered(term: string, phrases: string[]): boolean {
  const re = themeRegex(phrases);
  if (re && re.test(term)) return true;
  const tre = themeRegex([term]);
  return !!tre && phrases.some((p) => tre.test(p));
}

export function proposeThemes(seeds: ThemeSeed[], rows: TuneRow[], existing: Pick<Theme, "name" | "phrases" | "exclude">[], opts: ProposeOpts = {}): ProposeResult {
  const dismissed = opts.dismissed ?? new Set<string>();
  const boosts = opts.boosts ?? {};
  const skipped: ProposeResult["skipped"] = [];
  if (!rows.length) return { proposals: [], considered: seeds.length, skipped, note: "no stored items to read" };

  // Shared per-row candidate terms (one extraction per row for every seed).
  const termCache = new Map<string, Map<string, string>>();
  const terms = (r: TuneRow) => { let m = termCache.get(r.id); if (!m) { m = candidateTerms(r.text); termCache.set(r.id, m); } return m; };
  const hitsOf = (phrases: string[], exclude?: string[]): Set<string> => {
    const re = themeRegex(phrases);
    const out = new Set<string>();
    if (!re) return out;
    for (const r of rows) if (re.test(exclude?.length ? maskExclusions(r.text, exclude) : r.text)) out.add(r.id);
    return out;
  };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const existingHits = existing.map((t) => ({ name: t.name, ids: hitsOf(t.phrases, t.exclude) }));

  const describe = (ids: Set<string>) => {
    const src = new Set<string>();
    const byKind: Partial<Record<ThemeSourceKind, number>> = {};
    const list: TuneRow[] = [];
    for (const id of ids) { const r = byId.get(id); if (!r) continue; src.add(r.source); byKind[r.kind] = (byKind[r.kind] ?? 0) + 1; list.push(r); }
    list.sort((a, b) => b.t - a.t);
    const samples = list.slice(0, 3).map((r) => ({ id: r.id, title: r.title, source: r.source, link: r.link, pubDate: new Date(r.t).toISOString() }));
    return { sources: src.size, byKind, samples };
  };
  const overlapOf = (ids: Set<string>) => {
    let best: { theme: string; share: number; size: number } | null = null;
    for (const e of existingHits) {
      let n = 0;
      for (const id of ids) if (e.ids.has(id)) n++;
      const share = ids.size ? n / ids.size : 0;
      if (share > 0 && (!best || share > best.share)) best = { theme: e.name, share, size: e.ids.size };
    }
    return best;
  };

  interface Term { key: string; term: string; a: number; b: number; srcA: number; srcB: number; lift: number; ids: Set<string> }
  /** Terms far likelier in `matched` than in the rest of the pool. */
  const coTerms = (matched: Set<string>, phrases: string[]): Term[] => {
    const A = matched.size;
    const B = rows.length - A;
    const acc = new Map<string, { surface: Map<string, number>; a: number; b: number; srcA: Set<string>; srcB: Set<string>; ids: Set<string> }>();
    for (const id of matched) {
      const r = byId.get(id)!;
      for (const [k, s] of terms(r)) {
        let x = acc.get(k);
        if (!x) { x = { surface: new Map(), a: 0, b: 0, srcA: new Set(), srcB: new Set(), ids: new Set() }; acc.set(k, x); }
        x.surface.set(s, (x.surface.get(s) ?? 0) + 1);
        x.a++; x.srcA.add(r.source); x.ids.add(id);
      }
    }
    for (const r of rows) {
      if (matched.has(r.id)) continue;
      for (const k of terms(r).keys()) { const x = acc.get(k); if (!x) continue; x.b++; x.srcB.add(r.source); x.ids.add(r.id); }
    }
    const out: Term[] = [];
    for (const [k, x] of acc) {
      if (x.a < 3 || x.srcA.size < 2) continue;
      const term = [...x.surface.entries()].sort((p, q) => q[1] - p[1])[0][0];
      if (covered(term, phrases)) continue;
      const lift = (x.a / A) / ((x.b + 1) / (B + 1));
      if (lift < LIFT_MIN) continue;
      out.push({ key: k, term, a: x.a, b: x.b, srcA: x.srcA.size, srcB: x.srcB.size, lift, ids: x.ids });
    }
    return out.sort((p, q) => q.lift - p.lift || q.a - p.a || q.term.length - p.term.length);
  };

  const all: ThemeProposal[] = [];
  for (const seed of seeds) {
    const seedKey = `seed:${seed.key}`;
    // Phrases that name something in the window.
    const live = seed.phrases.filter((p) => hitsOf([p]).size > 0);
    const droppedPhrases = seed.phrases.filter((p) => !live.includes(p));
    if (!live.length) { skipped.push({ key: seed.key, name: seed.name, reason: "names nothing in your sources" }); continue; }
    const matched = hitsOf(live);
    const d0 = describe(matched);
    if (matched.size < PROPOSE_MIN_ITEMS || d0.sources < PROPOSE_MIN_SOURCES) {
      skipped.push({ key: seed.key, name: seed.name, reason: `${plural(matched.size, "item")} from ${plural(d0.sources, "source")} — a proposal needs ${PROPOSE_MIN_ITEMS} from ${PROPOSE_MIN_SOURCES}` });
      continue;
    }
    const co = coTerms(matched, live);

    // Base proposal: the live phrases + a few broadening terms (the
    // suggested-phrase rule: adds items, never swamps the seed's own).
    const added: ThemeProposal["added"] = [];
    const phrases = live.slice(0, THEME_MAX_PHRASES);
    for (const c of co) {
      if (added.length >= PROPOSE_MAX_ADDS || phrases.length >= THEME_MAX_PHRASES) break;
      if (c.b < 1 || c.b > 2 * matched.size + 5) continue;
      if (added.some((x) => covered(c.term, [x.term]) || covered(x.term, [c.term]))) continue;
      added.push({ term: c.term, why: `in ${c.a} of its ${matched.size} items from ${c.srcA} sources · would add ${plural(c.b, "item")}` });
      phrases.push(c.term);
    }
    const finalIds = added.length ? hitsOf(phrases) : matched;
    if (!dismissed.has(seedKey)) {
      const ov = overlapOf(finalIds);
      const d = describe(finalIds);
      if (ov && ov.share > PROPOSE_MAX_OVERLAP) {
        skipped.push({ key: seed.key, name: seed.name, reason: `your theme “${ov.theme}” already catches ${pct(ov.share)} of its items` });
      } else if (!validateThemeDraft({ name: seed.name, phrases })) {
        const boost = Math.min(20, seed.interest.reduce((s, k) => s + (boosts[k.toLowerCase()] ?? 0), 0));
        const why = [
          `from ${seed.label}`,
          `matches ${plural(finalIds.size, "item")} from ${plural(d.sources, "source")} in your stored sources`,
          ov ? `${pct(ov.share)} overlap with “${ov.theme}”` : "no overlap with your themes",
          boost > 0 ? "you open it often" : "",
        ].filter(Boolean).join(" · ");
        all.push({
          key: seedKey, kind: "seed", name: seed.name, phrases, origin: seed.origin, originLabel: seed.label,
          items: finalIds.size, sources: d.sources, byKind: d.byKind, droppedPhrases, added,
          overlap: ov ? { theme: ov.theme, share: ov.share } : null, why, samples: d.samples,
          score: seed.weight + boost + Math.min(20, 2 * d.sources) + Math.min(10, finalIds.size / 5),
        });
      }
    }

    // Narrower proposal: a cluster of context-bound co-terms (each mostly
    // appears in the seed's items), joined by sharing items.
    const bound = co.filter((c) => c.b <= c.a).slice(0, 12);
    let best: { members: Term[]; ids: Set<string> } | null = null;
    const used = new Set<string>();
    for (const c of bound) {
      if (used.has(c.key)) continue;
      const members = [c];
      used.add(c.key);
      for (const o of bound) {
        if (used.has(o.key) || members.length >= 5) continue;
        if (members.some((m) => covered(o.term, [m.term]) || covered(m.term, [o.term]))) { used.add(o.key); continue; }
        let inter = 0;
        for (const id of o.ids) if (members.some((m) => m.ids.has(id))) inter++;
        if (o.ids.size && inter / o.ids.size >= CLUSTER_SHARE) { members.push(o); used.add(o.key); }
      }
      if (members.length < 2) continue;
      const ids = hitsOf(members.map((m) => m.term));
      if (!best || ids.size > best.ids.size) best = { members, ids };
    }
    if (best) {
      const termsN = best.members.map((m) => m.term);
      const nKey = `narrow:${seed.key}:${termsN.map(keyOf).sort().join("|")}`;
      const d = describe(best.ids);
      if (dismissed.has(nKey)) continue;
      if (best.ids.size < PROPOSE_MIN_ITEMS || d.sources < PROPOSE_MIN_SOURCES) continue;
      const ov = overlapOf(best.ids);
      // A narrower theme inside a much broader one you have is still new — a
      // separate volume signal; inside one about its own size is a duplicate.
      if (ov && ov.share > PROPOSE_MAX_OVERLAP) {
        const e = existingHits.find((x) => x.name === ov.theme);
        if (!e || e.ids.size < 2 * best.ids.size) { skipped.push({ key: nKey, name: `${seed.name} · ${termsN[0]}`, reason: `your theme “${ov.theme}” already catches ${pct(ov.share)} of its items` }); continue; }
      }
      const name = clipName(`${seed.name.split(" · ")[0]} · ${termsN.slice(0, 2).join(" & ")}`);
      if (validateThemeDraft({ name, phrases: termsN })) continue;
      const boost = Math.min(20, seed.interest.reduce((s, k) => s + (boosts[k.toLowerCase()] ?? 0), 0));
      all.push({
        key: nKey, kind: "narrow", name, phrases: termsN, origin: seed.origin, originLabel: seed.label,
        items: best.ids.size, sources: d.sources, byKind: d.byKind, droppedPhrases: [],
        added: best.members.map((m) => ({ term: m.term, why: `in ${m.a} of the ${matched.size} items naming ${seed.name.split(" · ")[0]} · ${m.lift >= 100 ? "rarely" : `${Math.round(m.lift)}× less often`} elsewhere` })),
        overlap: ov ? { theme: ov.theme, share: ov.share } : null,
        why: [
          `narrows ${seed.label}: these words keep appearing together in its items`,
          `matches ${plural(best.ids.size, "item")} from ${plural(d.sources, "source")}`,
          ov ? `inside your broader theme “${ov.theme}”` : "no overlap with your themes",
        ].join(" · "),
        samples: d.samples,
        score: seed.weight - 2 + boost + Math.min(20, 2 * d.sources) + Math.min(10, best.ids.size / 5),
      });
    }
  }

  // Two proposals catching nearly the same items: only the stronger is shown.
  all.sort((p, q) => q.score - p.score || q.items - p.items);
  const idsOf = new Map(all.map((p) => [p.key, hitsOf(p.phrases)]));
  const shown: ThemeProposal[] = [];
  for (const p of all) {
    const a = idsOf.get(p.key)!;
    const dup = shown.find((s) => {
      const b = idsOf.get(s.key)!;
      let n = 0;
      for (const id of a) if (b.has(id)) n++;
      return n / Math.max(1, Math.min(a.size, b.size)) > PROPOSE_DEDUPE_OVERLAP && Math.abs(a.size - b.size) < Math.max(a.size, b.size) / 2;
    });
    if (dup) { skipped.push({ key: p.key, name: p.name, reason: `catches nearly the same items as “${dup.name}”` }); continue; }
    shown.push(p);
    if (shown.length >= (opts.max ?? PROPOSE_MAX)) break;
  }
  return { proposals: shown, considered: seeds.length, skipped, note: seeds.length ? null : "nothing declared to propose from — set a hub, areas of interest or a watchlist" };
}
