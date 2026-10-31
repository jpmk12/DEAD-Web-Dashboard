// Server assembly for the declared themes — the PURE read (lib/themes) over
// the pools the app already gathers: the user's OWN sources (X captures,
// newsletters, reader-captured articles, the configured OSINT feeds — the
// same gatherUserSourceNews the I&W boards read) and, for the "wires agree"
// half, the base defense / strategic / overview RSS the News tab and the
// posture sweep already fetch (fetchFeed, 5-min cache). No GDELT query —
// the 1-per-5-s gate is spent elsewhere — and no model call.
//
// The `theme:<id>` series (the theme's own normal) is written ONLY when the
// own-source pool answered; a dead pool writes nothing and reads UNKNOWN.
// Bounded like every assembly: a request handler gets a warm cache at once,
// else what settles within maxWaitMs, else a pending stub.

import { fetchFeed } from "./rss";
import { BASE_NEWS_SOURCES } from "./newsSources";
import { gatherUserSourceNews } from "./warningSensors";
import { listThemes } from "./themeStore";
import { readThemes, sortThemeReads, type Theme, type ThemeRead } from "./themes";
import { recordSensorDay, getSensorBaseline } from "./sensorStore";
import { sensorKey } from "./sensorKeys";
import type { Baseline } from "./series";
import type { NewsItem } from "./types";

export interface ThemesBody {
  generatedAt: string;
  /** The declared register; NULL when the store did not answer. */
  themes: Theme[] | null;
  reads: ThemeRead[];
  pool: { own: number; ownAnswered: boolean; wires: number; wireFeeds: number; wireFeedsTotal: number };
  pending?: boolean;
  note?: string;
}

const TTL = 5 * 60 * 1000;
let cache: { at: number; body: ThemesBody } | null = null;
let inflight: Promise<ThemesBody> | null = null;
// Bumped on a write (see lib/lineReadAssemble): an older in-flight read must
// not be cached over a theme just saved.
let gen = 0;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

export async function getThemeReadsFull(): Promise<ThemesBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  const mine = gen;
  const p: Promise<ThemesBody> = assemble()
    .then((body) => { if (mine === gen) cache = { at: Date.now(), body }; return body; })
    .finally(() => { if (inflight === p) inflight = null; });
  inflight = p;
  return p;
}

export async function getThemeReads(opts: { maxWaitMs?: number; force?: boolean } = {}): Promise<ThemesBody> {
  if (opts.force) { cache = null; inflight = null; gen++; }
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  const settled = await withTimeout(getThemeReadsFull(), opts.maxWaitMs ?? 8_000);
  if (settled) return settled;
  if (cache) return { ...cache.body, pending: true };
  return { generatedAt: new Date().toISOString(), themes: null, reads: [], pool: { own: 0, ownAnswered: false, wires: 0, wireFeeds: 0, wireFeedsTotal: 0 }, pending: true, note: "reading your sources — ask again shortly" };
}

export function resetThemesCache(): void { cache = null; inflight = null; gen++; }

async function assemble(): Promise<ThemesBody> {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const themes = await listThemes();
  if (themes === null) {
    return { generatedAt: new Date(now).toISOString(), themes: null, reads: [], pool: { own: 0, ownAnswered: false, wires: 0, wireFeeds: 0, wireFeedsTotal: 0 }, note: "the theme store did not answer" };
  }
  if (!themes.length) {
    return { generatedAt: new Date(now).toISOString(), themes, reads: [], pool: { own: 0, ownAnswered: false, wires: 0, wireFeeds: 0, wireFeedsTotal: 0 } };
  }

  const feeds = BASE_NEWS_SOURCES.filter((s) => s.category === "defense" || s.category === "strategic" || s.category === "overview");
  const [ownRes, wireRes] = await Promise.all([
    withTimeout(gatherUserSourceNews({ terms: /(?:)/ }), 20_000),
    Promise.all(feeds.map((f) => withTimeout(fetchFeed(f.url, f.name, f.category), 8_000))),
  ]);
  // The whole pool, not the mention-gated slice — a theme's phrases ARE its gate.
  // The 14-day pool: a theme counts reports over THEME_WINDOW_DAYS, and the
  // newest-400 slice held about one day of X.
  const own: NewsItem[] = ownRes?.window ?? [];
  // Answered only when at least one own-source door did (code review
  // 2026-10-28: the gatherer never returns null — every door swallows its
  // own failure — so a fully dead pool read as "quiet" and wrote 0s into
  // every theme's baseline).
  const ownAnswered = ownRes !== null && ownRes.answered > 0;
  const wires: NewsItem[] = [];
  let wireFeeds = 0;
  for (const r of wireRes) { if (!r || !r.ok) continue; wireFeeds++; wires.push(...r.items); }

  const baselines: Record<string, Baseline | null> = {};
  await Promise.all(themes.map(async (t) => {
    baselines[t.id] = await withTimeout(getSensorBaseline(sensorKey("theme", t.id), today, 30), 4_000);
  }));

  const reads = sortThemeReads(readThemes(themes, own, { nowMs: now, baselines, wires: wireFeeds ? wires : null, observed: ownAnswered }));

  // The series: today's count per theme, written only from an answered pool.
  if (ownAnswered) for (const r of reads) recordSensorDay(sensorKey("theme", r.id), today, r.volume.today).catch(() => {});

  return {
    generatedAt: new Date(now).toISOString(),
    themes, reads,
    pool: { own: own.length, ownAnswered, wires: wires.length, wireFeeds, wireFeedsTotal: feeds.length },
  };
}
