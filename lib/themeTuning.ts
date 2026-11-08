// Theme TUNING — how the data you already collect can make a declared theme
// better. PURE, client-safe, no model call; tested in tests/themeTuning.test.ts.
//
// Five reads over the stored own-source pool (14 days of X, newsletters,
// captured articles, OSINT feeds):
//
//   - previewPhrases: what a phrase set WOULD have caught, before you save it.
//   - phraseStats:    each phrase's hits and sources, and its precision from
//                     the crew's ✓ / ✕ marks — "dead" (no hit in the window)
//                     and "noisy" (judged mostly wrong) flags with the reason.
//   - suggestPhrases: terms far more common in the theme's matched items
//                     than in the rest of the pool, which would ALSO catch
//                     items the theme misses now. Every row states its
//                     evidence; a declined term is never suggested again.
//   - probableMisses: items that name two or more of the theme's strong
//                     co-terms and none of its phrases.
//   - backfillSeries: the theme's daily series rebuilt from the stored pool,
//                     only over days every source kind that carries the theme
//                     actually covers — so a new or edited theme does not sit
//                     in "learning" for a week, and never learns a normal from
//                     a day its sources did not reach.
//
// Disciplines: counts, never a mood; evidence floors before any suggestion
// (≥ 3 matched items, ≥ 2 sources); a ✕-marked item is neither evidence for
// nor against a term; nothing here changes a level.

import type { NewsItem } from "./types";
import {
  themeRegex, maskExclusions, whichPhrase, sourceKindOf, phrasePattern, itemKey,
  type Theme, type ThemeSourceKind,
} from "./themes";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const TUNE_WINDOW_DAYS = 14;
/** Matched items needed before any term is suggested. */
export const SUGGEST_MIN_MATCHED = 3;
/** A suggested term must sit in at least this many matched items … */
export const SUGGEST_MIN_IN = 3;
/** … from at least this many distinct sources … */
export const SUGGEST_MIN_SOURCES = 2;
/** … and be this many times likelier there than in the rest of the pool. */
export const SUGGEST_MIN_LIFT = 4;
/** Judged items needed before a phrase's precision is stated. */
export const PRECISION_MIN_JUDGED = 3;
/** A phrase judged right less often than this is flagged noisy. */
export const NOISY_BELOW = 0.5;
/** A kind of source carrying at least this share of a theme's matches must
 *  reach back to a day for that day to be backfilled. */
export const BACKFILL_KIND_SHARE = 0.2;

export interface TuneRow {
  id: string;
  /** Title + summary, whitespace-collapsed — what the phrases are matched against. */
  text: string;
  title: string;
  source: string;
  kind: ThemeSourceKind;
  link: string;
  t: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The pool as rows inside the window, deduped by id, newest first. */
export function tuneRows(items: NewsItem[], nowMs: number, windowDays = TUNE_WINDOW_DAYS): TuneRow[] {
  const seen = new Set<string>();
  const out: TuneRow[] = [];
  for (const n of items) {
    const t = Date.parse(n.pubDate);
    if (!Number.isFinite(t) || nowMs - t > windowDays * DAY || t - nowMs > DAY) continue;
    const id = itemKey(n);
    if (seen.has(id)) continue;
    seen.add(id);
    const source = (n.source || "").trim() || "unknown";
    const text = `${n.title} ${n.summary ?? ""}`.replace(/\s+/g, " ").trim();
    out.push({ id, text, title: clip(text, 220), source, kind: sourceKindOf(source), link: n.link || "", t });
  }
  return out.sort((a, b) => b.t - a.t);
}

/** The window's reach per source kind (oldest item each kind holds). */
export function coverageOf(rows: TuneRow[], nowMs: number): { items: number; byKind: Partial<Record<ThemeSourceKind, { items: number; oldest: string }>>; days: number } {
  const byKind: Partial<Record<ThemeSourceKind, { items: number; oldest: string }>> = {};
  let oldest = nowMs;
  for (const r of rows) {
    const k = byKind[r.kind] ?? { items: 0, oldest: new Date(r.t).toISOString() };
    k.items++;
    if (r.t < Date.parse(k.oldest)) k.oldest = new Date(r.t).toISOString();
    byKind[r.kind] = k;
    if (r.t < oldest) oldest = r.t;
  }
  return { items: rows.length, byKind, days: rows.length ? Math.max(1, Math.ceil((nowMs - oldest) / DAY)) : 0 };
}

// ── Preview ──────────────────────────────────────────────────────────────

export interface PhrasePreview {
  /** Items the phrase set (with exclusions) matches in the window. */
  total: number;
  sources: number;
  byKind: Partial<Record<ThemeSourceKind, number>>;
  /** Hits per phrase, each counted on its own (an item naming two counts for both). */
  byPhrase: { phrase: string; hits: number }[];
  /** Items the phrases name that the exclusions removed. */
  excluded: number;
  samples: { id: string; title: string; source: string; link: string; pubDate: string; phrase: string }[];
  /** The days the window actually reaches. */
  days: number;
}

export function previewPhrases(phrases: string[], exclude: string[], rows: TuneRow[], nowMs: number, sampleCount = 6): PhrasePreview {
  const re = themeRegex(phrases);
  const byPhrase = phrases.map((p) => ({ phrase: p, hits: 0, re: themeRegex([p]) }));
  const byKind: Partial<Record<ThemeSourceKind, number>> = {};
  const sources = new Set<string>();
  const samples: PhrasePreview["samples"] = [];
  let total = 0;
  let excluded = 0;
  if (re) {
    for (const r of rows) {
      const masked = maskExclusions(r.text, exclude);
      const m = re.exec(masked);
      if (!m) {
        if (exclude.length && re.test(r.text)) excluded++;
        continue;
      }
      total++;
      sources.add(r.source);
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      for (const b of byPhrase) if (b.re && b.re.test(masked)) b.hits++;
      if (samples.length < sampleCount) samples.push({ id: r.id, title: r.title, source: r.source, link: r.link, pubDate: new Date(r.t).toISOString(), phrase: whichPhrase(phrases, m[0]) });
    }
  }
  return { total, sources: sources.size, byKind, byPhrase: byPhrase.map(({ phrase, hits }) => ({ phrase, hits })), excluded, samples, days: coverageOf(rows, nowMs).days };
}

// ── Feedback and phrase stats ────────────────────────────────────────────

export type ThemeVerdict = "yes" | "no";
export interface ThemeFeedback { themeId: string; itemId: string; verdict: ThemeVerdict; phrase: string; by: string; at: string }

export interface PhraseStat {
  phrase: string;
  hits: number;
  sources: number;
  lastSeen: string | null;
  /** Items only this phrase caught (the others would not have). */
  only: number;
  yes: number;
  no: number;
  /** yes / (yes + no) once PRECISION_MIN_JUDGED items are judged, else null. */
  precision: number | null;
  flag: "dead" | "noisy" | null;
  why: string;
}

export function phraseStats(theme: Pick<Theme, "phrases" | "exclude">, rows: TuneRow[], feedback: ThemeFeedback[], nowMs: number): PhraseStat[] {
  const days = coverageOf(rows, nowMs).days;
  const regs = theme.phrases.map((p) => themeRegex([p]));
  const stats = theme.phrases.map((phrase) => ({ phrase, hits: 0, src: new Set<string>(), last: 0, only: 0 }));
  for (const r of rows) {
    const masked = maskExclusions(r.text, theme.exclude);
    const hit: number[] = [];
    regs.forEach((re, i) => { if (re && re.test(masked)) hit.push(i); });
    for (const i of hit) {
      const s = stats[i];
      s.hits++;
      s.src.add(r.source);
      if (r.t > s.last) s.last = r.t;
      if (hit.length === 1) s.only++;
    }
  }
  return stats.map((s) => {
    const judged = feedback.filter((f) => f.phrase.toLowerCase() === s.phrase.toLowerCase());
    const yes = judged.filter((f) => f.verdict === "yes").length;
    const no = judged.length - yes;
    const precision = yes + no >= PRECISION_MIN_JUDGED ? yes / (yes + no) : null;
    let flag: PhraseStat["flag"] = null;
    let why = `${s.hits} item${s.hits === 1 ? "" : "s"} from ${s.src.size} source${s.src.size === 1 ? "" : "s"} in ${days} d`;
    if (s.hits && s.only) why += ` · ${s.only} caught by this phrase alone`;
    if (s.hits === 0 && days >= 7) { flag = "dead"; why = `no item in ${days} days of your sources — drop it, or check the spelling`; }
    else if (precision != null && precision < NOISY_BELOW) { flag = "noisy"; why = `marked wrong ${no} of ${yes + no} times — add an exclusion or drop it`; }
    else if (precision != null) why += ` · right ${yes} of ${yes + no} times marked`;
    return { phrase: s.phrase, hits: s.hits, sources: s.src.size, lastSeen: s.last ? new Date(s.last).toISOString() : null, only: s.only, yes, no, precision, flag, why };
  });
}

// ── Candidate terms ──────────────────────────────────────────────────────

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had", "was", "were", "are", "will", "would", "could", "should",
  "they", "their", "them", "there", "here", "what", "when", "where", "which", "while", "about", "after", "before", "over", "under",
  "into", "onto", "than", "then", "just", "also", "more", "most", "some", "such", "only", "very", "been", "being", "says", "said",
  "according", "report", "reports", "reported", "reportedly", "breaking", "update", "news", "today", "yesterday", "week", "year",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "june",
  "july", "august", "september", "october", "november", "december", "via", "per", "amid", "against", "between", "during", "without",
  "within", "across", "along", "around", "because", "still", "already", "again", "other", "these", "those", "every", "each", "many",
  "much", "your", "our", "his", "her", "its", "who", "whom", "whose", "why", "how", "all", "any", "not", "but", "can", "may", "might",
  "must", "new", "now", "out", "off", "one", "two", "three", "first", "last", "next", "time", "times", "people", "video", "photo",
  "thread", "watch", "read", "live", "says", "told", "like", "make", "made", "take", "taken", "get", "got",
]);
const CONNECTORS = new Set(["of", "al", "el", "de", "la", "bin", "ibn", "von", "van"]);
const MAX_TERMS_PER_ITEM = 80;

interface Tok { w: string; cap: boolean; code: boolean }

function tokens(text: string): Tok[] {
  const clean = text.replace(/https?:\/\/\S+/g, " ").replace(/@[\w]+/g, " ");
  const out: Tok[] = [];
  for (const m of clean.matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)) {
    const w = m[0];
    const hasL = /\p{L}/u.test(w);
    const hasN = /\p{N}/u.test(w);
    out.push({ w, cap: /^\p{Lu}/u.test(w), code: hasL && hasN });
  }
  return out;
}

const keyOf = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

/** Candidate terms an item carries: designators (KC-46, C-17), capitalised
 *  names and runs of up to three ("Al Udeid", "Strait of Hormuz"), and
 *  plain two-word phrases ("aerial refueling"). Key → the surface form. */
export function candidateTerms(text: string): Map<string, string> {
  const toks = tokens(text);
  const out = new Map<string, string>();
  const add = (s: string) => {
    if (out.size >= MAX_TERMS_PER_ITEM) return;
    const k = keyOf(s);
    if (k.length < 3 || /^\p{N}+$/u.test(k) || out.has(k)) return;
    out.set(k, s);
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const lw = t.w.toLowerCase();
    if (t.code && t.w.length >= 2 && !/^\p{N}+[\p{L}]{1,2}$/u.test(t.w)) { add(t.w); continue; }
    // A capitalised name particle ("Al Udeid", "El Paso", "Bin Qasim") may
    // start a run; elsewhere a connector or stopword starts nothing.
    const particle = t.cap && CONNECTORS.has(lw) && lw !== "of" && !!toks[i + 1]?.cap;
    if (!particle && (STOP.has(lw) || CONNECTORS.has(lw))) continue;
    if (t.cap && !particle && t.w.length >= 4) add(t.w);
    // A capitalised run: Name (connector? Name){1,2}
    if (t.cap) {
      const parts = [t.w];
      let j = i + 1;
      while (j < toks.length && parts.length < 5) {
        const n = toks[j];
        const nl = n.w.toLowerCase();
        if (CONNECTORS.has(nl) && toks[j + 1]?.cap && !STOP.has(toks[j + 1].w.toLowerCase())) { parts.push(n.w, toks[j + 1].w); j += 2; continue; }
        if (n.cap && !STOP.has(nl) && !n.code) { parts.push(n.w); j++; continue; }
        break;
      }
      // A capitalised particle counts as a word ("Al Udeid" is two); "of" and
      // a lower-case connector do not ("Strait of Hormuz" is two).
      const words = parts.filter((p) => !CONNECTORS.has(p.toLowerCase()) || (/^\p{Lu}/u.test(p) && p.toLowerCase() !== "of"));
      if (words.length >= 2 && words.length <= 3) add(parts.join(" "));
    }
    // A plain two-word phrase: both words ≥ 4 letters, neither a stopword.
    const n = toks[i + 1];
    if (n && !t.code && !n.code && t.w.length >= 4 && n.w.length >= 4 && !STOP.has(n.w.toLowerCase()) && !t.cap && !n.cap) add(`${t.w} ${n.w}`);
  }
  return out;
}

// ── Suggestions and misses ───────────────────────────────────────────────

export interface CoTerm { term: string; inMatched: number; inRest: number; lift: number; sources: number }

export interface PhraseSuggestion {
  term: string;
  /** Matched items naming it, of `matched`. */
  inMatched: number;
  matched: number;
  sources: number;
  /** Items the theme misses today that this term would add. */
  wouldAdd: number;
  addSources: number;
  lift: number;
  why: string;
}

export interface ProbableMiss {
  id: string; title: string; source: string; link: string; pubDate: string;
  /** The theme's co-terms the item names. */
  terms: string[];
  /** The phrase that would catch it (the strongest co-term it names). */
  suggest: string;
}

export interface TuneSuggestions {
  matched: number;
  suggestions: PhraseSuggestion[];
  misses: ProbableMiss[];
  coTerms: CoTerm[];
  note: string | null;
}

/** True when a candidate term is already a theme phrase, contains one, or is
 *  a word inside one — adding it would change nothing. */
function covered(term: string, phrases: string[]): boolean {
  const re = themeRegex(phrases);
  if (re && re.test(term)) return true;
  const tre = themeRegex([term]);
  return !!tre && phrases.some((p) => tre.test(p));
}

const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : x > 0 ? "<1%" : "0%");

export function suggestPhrases(
  theme: Pick<Theme, "phrases" | "exclude" | "dismissed">,
  rows: TuneRow[],
  opts: { rejected?: Set<string>; max?: number; maxMisses?: number } = {},
): TuneSuggestions {
  const re = themeRegex(theme.phrases);
  const rejected = opts.rejected ?? new Set<string>();
  const empty: TuneSuggestions = { matched: 0, suggestions: [], misses: [], coTerms: [], note: null };
  if (!re) return { ...empty, note: "no usable phrase" };

  const matched: TuneRow[] = [];
  const rest: TuneRow[] = [];
  for (const r of rows) {
    if (rejected.has(r.id)) continue; // a ✕-marked item is evidence for nothing
    (re.test(maskExclusions(r.text, theme.exclude)) ? matched : rest).push(r);
  }
  if (matched.length < SUGGEST_MIN_MATCHED) {
    return { ...empty, matched: matched.length, note: `${matched.length} matched item${matched.length === 1 ? "" : "s"} in the window — suggestions need ${SUGGEST_MIN_MATCHED}` };
  }

  const termsOf = new Map<string, Map<string, string>>();
  const get = (r: TuneRow) => { let m = termsOf.get(r.id); if (!m) { m = candidateTerms(r.text); termsOf.set(r.id, m); } return m; };
  interface Acc { surface: Map<string, number>; a: number; srcA: Set<string>; b: number; srcB: Set<string> }
  const acc = new Map<string, Acc>();
  const touch = (k: string, surface: string) => {
    let x = acc.get(k);
    if (!x) { x = { surface: new Map(), a: 0, srcA: new Set(), b: 0, srcB: new Set() }; acc.set(k, x); }
    x.surface.set(surface, (x.surface.get(surface) ?? 0) + 1);
    return x;
  };
  for (const r of matched) for (const [k, s] of get(r)) { const x = touch(k, s); x.a++; x.srcA.add(r.source); }
  for (const r of rest) for (const [k, s] of get(r)) { const x = acc.get(k); if (!x) continue; x.b++; x.srcB.add(r.source); }

  const A = matched.length;
  const B = rest.length;
  const dismissed = new Set((theme.dismissed ?? []).map(keyOf));
  const excl = theme.exclude ?? [];
  const candidates: (CoTerm & { srcB: number })[] = [];
  for (const [k, x] of acc) {
    if (x.a < 2) continue;
    const term = [...x.surface.entries()].sort((p, q) => q[1] - p[1])[0][0];
    if (dismissed.has(k) || covered(term, theme.phrases) || (excl.length && covered(term, excl))) continue;
    const lift = (x.a / A) / ((x.b + 1) / (B + 1));
    candidates.push({ term, inMatched: x.a, inRest: x.b, lift, sources: x.srcA.size, srcB: x.srcB.size });
  }
  // Ties go to the longer term, so "Al Udeid" is offered and "Udeid" (a word
  // inside it) is then covered.
  candidates.sort((p, q) => q.lift - p.lift || q.inMatched - p.inMatched || q.term.length - p.term.length);

  const coTerms: CoTerm[] = candidates.filter((c) => c.lift >= SUGGEST_MIN_LIFT && c.sources >= 2).slice(0, 15).map(({ srcB: _s, ...c }) => c);

  // Suggestions: strong co-terms that would ALSO catch items the theme misses,
  // without swamping it (at most twice the theme's own matches, plus five).
  const suggestions: PhraseSuggestion[] = [];
  for (const c of candidates) {
    if (suggestions.length >= (opts.max ?? 6)) break;
    if (c.inMatched < SUGGEST_MIN_IN || c.sources < SUGGEST_MIN_SOURCES || c.lift < SUGGEST_MIN_LIFT) continue;
    if (c.inRest < 1 || c.inRest > 2 * A + 5) continue;
    if (suggestions.some((s) => covered(c.term, [s.term]) || covered(s.term, [c.term]))) continue;
    suggestions.push({
      term: c.term, inMatched: c.inMatched, matched: A, sources: c.sources, wouldAdd: c.inRest, addSources: c.srcB, lift: c.lift,
      why: `in ${c.inMatched} of ${A} matched items from ${c.sources} sources · ${pct(c.inRest / Math.max(1, B))} of the rest of your sources · would add ${c.inRest} item${c.inRest === 1 ? "" : "s"} from ${c.srcB} source${c.srcB === 1 ? "" : "s"}`,
    });
  }

  // Probable misses: unmatched items naming two or more co-terms.
  const misses: ProbableMiss[] = [];
  if (coTerms.length >= 2) {
    const keys = coTerms.map((c) => ({ k: keyOf(c.term), c }));
    const scored: { r: TuneRow; terms: CoTerm[] }[] = [];
    for (const r of rest) {
      const m = get(r);
      const hit = keys.filter(({ k }) => m.has(k)).map(({ c }) => c);
      if (hit.length >= 2) scored.push({ r, terms: hit });
    }
    scored.sort((p, q) => q.terms.length - p.terms.length || q.r.t - p.r.t);
    for (const { r, terms } of scored.slice(0, opts.maxMisses ?? 8)) {
      const best = terms.slice().sort((p, q) => q.lift - p.lift)[0];
      misses.push({ id: r.id, title: r.title, source: r.source, link: r.link, pubDate: new Date(r.t).toISOString(), terms: terms.map((t) => t.term), suggest: best.term });
    }
  }

  return { matched: A, suggestions, misses, coTerms, note: null };
}

/** Exclusion phrases to offer when an item is marked ✕: the matched phrase
 *  with the word right before or after it ("oil tanker", "tanker truck").
 *  Only contiguous phrases — an exclusion must match the text as written. */
export function exclusionCandidates(text: string, phrase: string): string[] {
  if (!text || !phrase) return [];
  const re = new RegExp(`([\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*)?(\\s+)?(?<![\\p{L}\\p{N}])(${phrasePattern(phrase)})(?![\\p{L}\\p{N}])(\\s+)?([\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*)?`, "iu");
  const m = re.exec(text);
  if (!m) return [];
  const out: string[] = [];
  const core = m[3];
  const before = m[1] && m[2] ? m[1] : null;
  const after = m[4] && m[5] ? m[5] : null;
  if (before && !STOP.has(before.toLowerCase()) && before.length >= 2) out.push(`${before} ${core}`);
  if (after && !STOP.has(after.toLowerCase()) && after.length >= 2) out.push(`${core} ${after}`);
  return out.filter((x, i) => out.indexOf(x) === i);
}

// ── Backfill ─────────────────────────────────────────────────────────────

export interface Backfill {
  /** Prior UTC days, oldest first: the peak trailing-24-h count that day. */
  points: { day: string; value: number }[];
  /** Today's trailing-24-h count (what the live read would record). */
  today: number;
  /** The first day the pool fully covers, or null when nothing could be backfilled. */
  from: string | null;
  note: string;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Rebuild a theme's `theme:<id>` series from the stored pool. The live
 *  series is the PEAK trailing-24-h count seen on a day; the backfill
 *  emulates it with an hourly sweep. A day is backfilled only when every
 *  source kind that carries ≥ BACKFILL_KIND_SHARE of the theme reaches back
 *  past its start — a day the sources did not cover is not a quiet day. */
export function backfillSeries(theme: Pick<Theme, "phrases" | "exclude">, rows: TuneRow[], nowMs: number, maxDays = TUNE_WINDOW_DAYS - 1): Backfill {
  const re = themeRegex(theme.phrases);
  const today = dayOf(nowMs);
  if (!re || !rows.length) return { points: [], today: 0, from: null, note: rows.length ? "no usable phrase" : "no stored items to backfill from" };
  const hits = rows.filter((r) => re.test(maskExclusions(r.text, theme.exclude))).map((r) => r);
  const share = new Map<ThemeSourceKind, number>();
  for (const h of hits) share.set(h.kind, (share.get(h.kind) ?? 0) + 1);
  const carrying = hits.length
    ? [...share.entries()].filter(([, n]) => n / hits.length >= BACKFILL_KIND_SHARE).map(([k]) => k)
    : [...new Set(rows.map((r) => r.kind))];
  const oldestOf = (k: ThemeSourceKind) => Math.min(...rows.filter((r) => r.kind === k).map((r) => r.t));
  const reach = Math.max(...carrying.map(oldestOf));
  const startOfToday = Date.parse(`${today}T00:00:00Z`);
  // The first FULL day after the oldest item of the shallowest carrying kind.
  let first = Date.parse(`${dayOf(reach)}T00:00:00Z`) + DAY;
  first = Math.max(first, startOfToday - maxDays * DAY);
  const times = hits.map((h) => h.t).sort((a, b) => a - b);
  const count = (end: number) => times.filter((t) => t > end - DAY && t <= end).length;
  const points: { day: string; value: number }[] = [];
  for (let d = first; d < startOfToday; d += DAY) {
    let peak = 0;
    for (let h = 1; h <= 24; h++) peak = Math.max(peak, count(d + h * HOUR));
    points.push({ day: dayOf(d), value: peak });
  }
  const kinds = carrying.join(", ") || "none";
  const note = points.length
    ? `backfilled ${points.length} day${points.length === 1 ? "" : "s"} from your stored sources (from ${points[0].day}; ${kinds} reach that far)`
    : `nothing to backfill — the ${kinds} items stored do not reach a full day back`;
  return { points, today: count(nowMs), from: points[0]?.day ?? null, note };
}
