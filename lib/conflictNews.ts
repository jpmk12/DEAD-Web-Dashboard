// Active-conflict news signal for the Force Protection conflict axis. The
// structured conflict datasets we score from are all blind to a SUDDEN war:
// ACLED's free tier embargoes data <12 months old, UCDP lags 1-2 months (and
// now needs a token), and INFORM is a slow structural index. So a war that broke
// out this month leaves every structured layer green. This module closes that
// gap with the timeliest open signal — recent news — scored per country.
//
// Reuses the keyless GDELT DOC feed (lib/localNews) the app already polls, so it
// adds no new dependency or credential. The scorer is PURE (unit-tested); the
// fetch is a bounded, fail-safe fan-out over the watched countries.

import { gdeltLocalNews } from "./localNews";
import type { NewsItem } from "./types";

export interface ConflictNewsSignal {
  count: number;          // recent articles about this country with a conflict signal
  escalation: boolean;    // an active-hostilities phrase is present (war/airstrike/…)
  latest?: { title: string; link: string; source: string; pubDate: string };
}

// Active-hostilities phrases — kept attack-specific (not bare "missile"/"nuclear")
// so routine defense/diplomacy coverage doesn't false-trigger an escalation.
const ESCALATION = [
  "airstrike", "air strike", "air raid", "missile attack", "missile strike", "missile barrage",
  "ballistic missile", "drone strike", "drone attack", "shelling", "shelled", "bombard", "bombing raid",
  "invasion", "invaded", "ground offensive", "launched an offensive", "declared war", "at war",
  "under attack", "cross-border attack", "artillery fire", "rocket attack", "war erupt",
];
// Broader conflict vocabulary (amber-level) — escalation terms plus lower-intensity violence.
const CONFLICT = [
  ...ESCALATION,
  "killed in", "armed clash", "clashes", "militants", "insurgents", "gunmen", "ambush", "siege",
  "coup", "ceasefire collaps", "heavy fighting", "combat", "casualties", "escalat", "strikes on",
  "strike on", "attack on", "armed group", "offensive",
];

function hay(a: NewsItem): string {
  return `${a.title} ${a.summary ?? ""}`.toLowerCase();
}

// PURE: score a country's recent articles for conflict / active-hostilities.
// Exported for unit testing.
export function scoreConflictNews(articles: NewsItem[]): ConflictNewsSignal {
  const hits = articles.filter((a) => { const h = hay(a); return CONFLICT.some((k) => h.includes(k)); });
  const escalation = hits.some((a) => { const h = hay(a); return ESCALATION.some((k) => h.includes(k)); });
  hits.sort((a, b) => Date.parse(b.pubDate || "0") - Date.parse(a.pubDate || "0"));
  const top = hits[0];
  return {
    count: hits.length,
    escalation,
    ...(top ? { latest: { title: top.title, link: top.link, source: top.source, pubDate: top.pubDate } } : {}),
  };
}

// Fetch recent news per country and score it. Bounded fan-out (each
// gdeltLocalNews call is cached 60 min and fail-safe to []), keyed by lowercased
// country so the scorer can look it up by ForceLocation.country.
export async function getConflictNewsByCountry(countries: string[]): Promise<Record<string, ConflictNewsSignal>> {
  const uniq = Array.from(new Set(countries.map((c) => c.trim()).filter(Boolean))).slice(0, 16);
  const out: Record<string, ConflictNewsSignal> = {};
  await Promise.all(uniq.map(async (c) => {
    const arts = await gdeltLocalNews(c).catch(() => [] as NewsItem[]);
    out[c.toLowerCase()] = scoreConflictNews(arts);
  }));
  return out;
}
