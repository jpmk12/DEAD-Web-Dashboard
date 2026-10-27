// Declared THEMES — what the operator wants to see their own sources saying.
// PURE, client-safe, dependency-free beyond the shared modality grammar;
// tested in tests/themes.test.ts.
//
// A theme is a NAME and a few PHRASES ("tanker surge": "tanker surge",
// "KC-135 wave", "refueling bridge"). The read is deliberately not a
// sentiment score — a model's tone number is a claim about mood the app
// cannot falsify. What the app CAN state honestly about a theme:
//
//   - VOLUME against the theme's OWN trailing normal (the chatter / mobility
//     rule): today's count of own-source items naming it vs the mean of the
//     prior observed days, with a learning floor before any claim. A theme
//     declared this morning reads "learning · day 1 of 7", never "surge".
//   - WHO is saying it: distinct handles / feeds. One handle is a lead, two
//     corroborate — the own-source discipline, unchanged.
//   - HOW it is framed: the shared gradeModality — a reported ACT, a declared
//     THREAT, an ANALYSIS piece, a REVERSAL. Counts, not a mood.
//   - Whether the WIRES also name it (the base news feeds the app already
//     reads). Own sources only → the read caps at WATCHING, and says so. A
//     theme never sets a level anywhere; it is the operator's lens.
//
// Matching is PHRASE-based, word-bounded and case-insensitive — "Hormuz"
// matches "Strait of Hormuz." and not "Hormuzian"; a phrase is regex-escaped
// so punctuation in it is literal.

import type { NewsItem } from "./types";
import { gradeModality, type Modality } from "./chokepointSignals";
import type { Baseline } from "./series";

export interface Theme {
  id: string;
  name: string;
  phrases: string[];
  /** Who declared or last edited it — the crew shares one register. */
  by: string;
  updatedAt: string;
}

export interface ThemeDraft { name: string; phrases: string[] }

export const THEME_MAX = 20;
export const THEME_MAX_PHRASES = 12;
export const THEME_NAME_MAX = 40;
export const THEME_PHRASE_MIN = 2;
export const THEME_PHRASE_MAX = 60;
/** Prior observed days before the volume read makes any claim. */
export const THEME_LEARNING_DAYS = 7;
/** Today's count must be at least this multiple of the theme's own mean … */
export const THEME_SURGE_FACTOR = 2;
/** … and at least this many items, so 1 vs 0.3 is not a surge. */
export const THEME_SURGE_FLOOR = 3;
/** Items older than this are not read (the lift-chatter window). */
export const THEME_WINDOW_DAYS = 7;
/** Matches kept per theme on the read (the rest are counted, not listed). */
export const THEME_MATCH_CAP = 20;

export type ThemeSourceKind = "x" | "newsletter" | "analysis" | "feed" | "wire";

export interface ThemeMatch {
  id: string;
  phrase: string;
  source: string;
  kind: ThemeSourceKind;
  title: string;
  link: string;
  pubDate: string;
  modality: Modality;
}

export type ThemeVolumeState = "surge" | "normal" | "quiet" | "learning" | "unobserved";

export interface ThemeVolume {
  state: ThemeVolumeState;
  /** Own-source items naming the theme in the trailing 24 h. */
  today: number;
  /** The theme's own trailing mean over prior observed days, or null. */
  normal: number | null;
  samples: number;
  why: string;
}

export interface ThemeRead {
  id: string;
  name: string;
  phrases: string[];
  /** Own-source items naming the theme inside the window. */
  reports: number;
  /** Distinct own sources (handles / feeds) among them. */
  handles: number;
  corroborated: boolean;
  /** Reports per UTC day inside the window (yyyy-mm-dd → n), for a strip. */
  byDay: Record<string, number>;
  framing: Record<Modality, number>;
  /** Newest match (own sources), or null. */
  lead: ThemeMatch | null;
  matches: ThemeMatch[];
  volume: ThemeVolume;
  /** Wire items (the base news feeds) naming the theme in the window; null when the wires were not read. */
  wires: number | null;
  /** The one sentence a surface shows. */
  line: string;
  /** True when the read rests on the operator's own sources alone — it then caps at watching. */
  ownOnly: boolean;
}

const DAY = 86_400_000;

/** Validate a proposed theme. Returns the sentence to show, or null when acceptable. */
export function validateThemeDraft(d: { name?: unknown; phrases?: unknown }): string | null {
  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (name.length < 2) return "Name the theme — two characters at least.";
  if (name.length > THEME_NAME_MAX) return `Keep the name under ${THEME_NAME_MAX} characters.`;
  if (!Array.isArray(d.phrases)) return "Phrases must be a list.";
  const phrases = normalizePhrases(d.phrases);
  if (!phrases.length) return "Give the theme at least one phrase to look for.";
  if (phrases.length > THEME_MAX_PHRASES) return `Keep it to ${THEME_MAX_PHRASES} phrases — a theme is a few spellings of one thing.`;
  for (const p of d.phrases) {
    if (typeof p !== "string") return "Each phrase must be text.";
    const t = p.trim();
    if (!t) continue;
    if (t.length < THEME_PHRASE_MIN) return `“${t}” is too short — ${THEME_PHRASE_MIN} characters at least.`;
    if (t.length > THEME_PHRASE_MAX) return `“${t.slice(0, 20)}…” is too long — under ${THEME_PHRASE_MAX} characters.`;
  }
  return null;
}

/** Trim, drop empties, dedupe case-insensitively, keep declaration order. */
export function normalizePhrases(raw: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (typeof p !== "string") continue;
    const t = p.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function normalizeThemeDraft(d: { name: unknown; phrases: unknown }): ThemeDraft {
  return { name: String(d.name).replace(/\s+/g, " ").trim().slice(0, THEME_NAME_MAX), phrases: normalizePhrases(Array.isArray(d.phrases) ? d.phrases : []).slice(0, THEME_MAX_PHRASES) };
}

/** "tanker surge, KC-135 wave\nrefueling bridge" → the list; commas and newlines split, a phrase may hold spaces. */
export function parsePhrasesText(text: string): string[] {
  return normalizePhrases(text.split(/[\n,;]+/));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex per theme: every phrase, word-bounded by lookarounds (a phrase
 *  may start or end with a non-word character, so \b alone would miss it). */
export function themeRegex(phrases: string[]): RegExp | null {
  const parts = phrases.map((p) => p.trim()).filter((p) => p.length >= THEME_PHRASE_MIN).map(escapeRe);
  if (!parts.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

/** The first phrase a text names, in the theme's own spelling, else null. */
export function matchTheme(theme: Pick<Theme, "phrases">, text: string): string | null {
  const re = themeRegex(theme.phrases);
  if (!re || !text) return null;
  const m = re.exec(text);
  if (!m) return null;
  const hit = m[0].toLowerCase();
  return theme.phrases.find((p) => p.toLowerCase() === hit) ?? m[0];
}

export function sourceKindOf(source: string): ThemeSourceKind {
  if (source.startsWith("𝕏")) return "x";
  if (source.startsWith("✉")) return "newsletter";
  if (source.startsWith("📄")) return "analysis";
  return "feed";
}

const hay = (n: NewsItem): string => `${n.title} ${n.summary ?? ""}`.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The volume read: today vs the theme's own normal. The caller passes the
 *  baseline it holds (prior observed days, today excluded); `observed`
 *  false means the own-source pool did not answer at all. */
export function themeVolume(today: number, baseline: Baseline | null, observed: boolean): ThemeVolume {
  if (!observed) return { state: "unobserved", today: 0, normal: null, samples: 0, why: "own sources did not answer — UNKNOWN, not quiet" };
  const samples = baseline?.samples ?? 0;
  const mean = baseline?.mean ?? null;
  if (samples < THEME_LEARNING_DAYS || mean == null) {
    return { state: "learning", today, normal: mean, samples, why: `learning its normal — day ${Math.min(samples + 1, THEME_LEARNING_DAYS)} of ${THEME_LEARNING_DAYS}${today ? ` · ${today} today` : ""}` };
  }
  const bar = Math.max(THEME_SURGE_FLOOR, mean * THEME_SURGE_FACTOR);
  if (today >= bar) return { state: "surge", today, normal: mean, samples, why: `${today} today vs ${mean.toFixed(1)}/day over ${samples} observed days` };
  if (today === 0 && mean >= 1) return { state: "quiet", today, normal: mean, samples, why: `none today vs ${mean.toFixed(1)}/day normal — absence of a post, not evidence of calm` };
  return { state: "normal", today, normal: mean, samples, why: `${today} today vs ${mean.toFixed(1)}/day over ${samples} observed days` };
}

export interface ReadThemesOpts {
  nowMs?: number;
  /** Prior-day baselines per theme id (the `theme:<id>` series). Absent → learning. */
  baselines?: Record<string, Baseline | null>;
  /** Wire items to count beside the own sources; undefined = the wires were not read. */
  wires?: NewsItem[] | null;
  /** False when the own-source pool itself did not answer. */
  observed?: boolean;
  windowDays?: number;
}

/** Read every theme against the own-source pool. Items outside the window
 *  are ignored; a theme with no match still gets a read (its volume says
 *  quiet / learning), so the card never drops a declared theme. */
export function readThemes(themes: Theme[], own: NewsItem[], opts: ReadThemesOpts = {}): ThemeRead[] {
  const now = opts.nowMs ?? Date.now();
  const windowDays = opts.windowDays ?? THEME_WINDOW_DAYS;
  const observed = opts.observed ?? true;
  const inWindow = (n: NewsItem): number | null => {
    const t = Date.parse(n.pubDate);
    if (!Number.isFinite(t) || now - t > windowDays * DAY || t - now > DAY) return null;
    return t;
  };
  const ownRows = own.map((n) => ({ n, t: inWindow(n), text: hay(n) })).filter((r): r is { n: NewsItem; t: number; text: string } => r.t !== null);
  const wireRows = opts.wires ? opts.wires.map((n) => ({ n, t: inWindow(n), text: hay(n) })).filter((r) => r.t !== null) : null;

  return themes.map((th) => {
    const re = themeRegex(th.phrases);
    const matches: ThemeMatch[] = [];
    const handles = new Set<string>();
    const byDay: Record<string, number> = {};
    const framing: Record<Modality, number> = { act: 0, threat: 0, analysis: 0, reversal: 0 };
    let reports = 0;
    let today = 0;
    if (re) {
      for (const r of ownRows) {
        const m = re.exec(r.text);
        if (!m) continue;
        reports++;
        const source = (r.n.source || "").trim() || "unknown";
        handles.add(source);
        const day = new Date(r.t).toISOString().slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + 1;
        if (now - r.t <= DAY) today++;
        const modality = gradeModality(r.text);
        framing[modality]++;
        const hit = m[0].toLowerCase();
        matches.push({
          id: r.n.id, phrase: th.phrases.find((p) => p.toLowerCase() === hit) ?? m[0], source, kind: sourceKindOf(source),
          title: clip(r.text, 220), link: r.n.link || "", pubDate: new Date(r.t).toISOString(), modality,
        });
      }
    }
    matches.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
    const wires = wireRows && re ? wireRows.filter((r) => re.test(r.text)).length : null;
    const volume = themeVolume(today, opts.baselines?.[th.id] ?? null, observed);
    const read: ThemeRead = {
      id: th.id, name: th.name, phrases: th.phrases,
      reports, handles: handles.size, corroborated: handles.size >= 2,
      byDay, framing, lead: matches[0] ?? null, matches: matches.slice(0, THEME_MATCH_CAP),
      volume, wires, line: "", ownOnly: !(wires && wires > 0),
    };
    read.line = themeLine(read);
    return read;
  });
}

const VOLUME_WORD: Record<ThemeVolumeState, string> = { surge: "SURGE", normal: "normal", quiet: "quiet", learning: "learning", unobserved: "UNKNOWN" };

/** The sentence a strip shows. Says the cap out loud when the read is own-source only. */
export function themeLine(r: ThemeRead): string {
  const parts: string[] = [`${r.name} · ${VOLUME_WORD[r.volume.state]}`];
  if (r.volume.state === "unobserved") { parts.push(r.volume.why); return parts.join(" — "); }
  const who = r.reports ? `${r.reports} item${r.reports === 1 ? "" : "s"} from ${r.handles} ${r.handles === 1 ? "source" : "sources"} in ${THEME_WINDOW_DAYS} d` : `nothing in your sources in ${THEME_WINDOW_DAYS} d`;
  const fr = (["act", "threat", "analysis", "reversal"] as Modality[]).filter((k) => r.framing[k]).map((k) => `${r.framing[k]} ${k}`).join(", ");
  const tail = [who, fr || "", r.wires == null ? "wires not read" : r.wires ? `${r.wires} wire item${r.wires === 1 ? "" : "s"} agree` : "own sources only — reads as watching at most"].filter(Boolean).join(" · ");
  parts.push(tail);
  if (r.volume.state === "learning" || r.volume.state === "surge") parts.push(r.volume.why);
  return parts.join(" — ");
}

/** Lines for the Ask pack and the brief: one per theme, surge / corroborated first. */
export function themeLines(reads: ThemeRead[], limit = 8): string[] {
  const rank = (r: ThemeRead) => (r.volume.state === "surge" ? 0 : r.corroborated ? 1 : r.reports ? 2 : r.volume.state === "unobserved" ? 3 : 4);
  return reads.slice().sort((a, b) => rank(a) - rank(b) || b.reports - a.reports).slice(0, limit).map((r) => {
    const lead = r.lead ? ` · newest: ${r.lead.source}: "${clip(r.lead.title, 120)}"` : "";
    return `- ${r.line}${lead}`;
  });
}

/** Surge / corroborated reads first, then by reports — the card's order. */
export function sortThemeReads(reads: ThemeRead[]): ThemeRead[] {
  const rank = (r: ThemeRead) => (r.volume.state === "surge" ? 0 : r.corroborated ? 1 : r.reports ? 2 : 3);
  return reads.slice().sort((a, b) => rank(a) - rank(b) || b.reports - a.reports || a.name.localeCompare(b.name));
}
