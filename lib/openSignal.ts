// Open-tracking — the cheapest implicit signal, finally collected past news.
//
// PURE, client-safe, unit-tested. `article_prefs` has always recorded which
// news articles you open; nothing recorded which SITREP base you read, which
// I&W board you expand, or which country you drill into. `surface_opens` now
// does, as counts per (surface, item) per user. This module turns those rows
// into weights the command palette uses as a rank boost and as its "Recent"
// group on an empty query.
//
// Disciplines: a weight DECAYS (half-life 30 days) so a base you read every
// morning last spring does not outrank the one you opened yesterday; the
// boost is CAPPED so it breaks ties among things that match the query and
// never lifts a non-match into the results; and the surfaces are exactly the
// palette's entity kinds, so an open row keys straight to a palette id.

export type OpenSurface = "base" | "board" | "country";
export const OPEN_SURFACES: OpenSurface[] = ["base", "board", "country"];

export function isOpenSurface(s: unknown): s is OpenSurface {
  return typeof s === "string" && (OPEN_SURFACES as string[]).includes(s);
}

export interface OpenRow {
  surface: OpenSurface;
  id: string;
  opens: number;
  /** Epoch ms of the most recent open. */
  lastOpenAt: number;
}

export const HALF_LIFE_DAYS = 30;
/** Rank points per decayed open, and the cap. A cap of 20 sits below the
 *  smallest positive token score (a mid-word substring is 30), so a boost
 *  can reorder matches but never manufacture one. */
export const POINTS_PER_OPEN = 4;
export const MAX_BOOST = 20;

export const paletteIdFor = (r: Pick<OpenRow, "surface" | "id">): string => `${r.surface}:${r.id}`;

/** Recency-decayed open weight per row. */
export function decayedOpens(r: OpenRow, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - r.lastOpenAt) / 86_400_000);
  return r.opens * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Palette id → rank boost (0..MAX_BOOST). */
export function openBoosts(rows: OpenRow[], nowMs = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!isOpenSurface(r.surface) || !r.id || !(r.opens > 0)) continue;
    out[paletteIdFor(r)] = Math.min(MAX_BOOST, POINTS_PER_OPEN * decayedOpens(r, nowMs));
  }
  return out;
}

/** The most-opened palette ids, strongest first — for the empty-query
 *  "Recent" group. Rows with no decayed weight left (or a single ancient
 *  open) fall off; the list is short by design. */
export function topOpened(rows: OpenRow[], limit = 4, nowMs = Date.now()): string[] {
  return rows
    .filter((r) => isOpenSurface(r.surface) && !!r.id && r.opens > 0)
    .map((r) => ({ id: paletteIdFor(r), w: decayedOpens(r, nowMs) }))
    .filter((x) => x.w >= 0.5)
    .sort((a, b) => b.w - a.w || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((x) => x.id);
}
