// Chokepoint interdiction reads — server-only, shared by the Economy tab's
// route and the demand horizon. Extracted from /api/markets/chokepoints so
// the horizon can read the straits without an HTTP hop; the 15-min cache
// keyed on the requested set moved with it.

import { CHOKEPOINTS, type Chokepoint } from "./chokepoints";
import { readActivity, type GeoEvent, type ChokepointText, type ActivityRead } from "./chokepointSignals";
import { getConflictPoints } from "./conflictEvents";
import { getAcledEvents } from "./acled";
import { gdeltLocalNews } from "./localNews";

export interface ChokepointRead extends Chokepoint, ActivityRead {
  totalEvents: number;
}

export interface ChokepointReadsBody {
  signals: ChokepointRead[];
  generatedAt: string;
  sources: { conflictEvents: number; acledEvents: number };
}

const TTL = 15 * 60 * 1000;
let cache: { at: number; key: string; body: ChokepointReadsBody } | null = null;
let inflight: { key: string; p: Promise<ChokepointReadsBody> } | null = null;

export async function getChokepointReads(ids?: string[]): Promise<ChokepointReadsBody> {
  const points = ids?.length ? CHOKEPOINTS.filter((c) => ids.includes(c.id)) : CHOKEPOINTS;
  if (points.length === 0) return { signals: [], generatedAt: new Date().toISOString(), sources: { conflictEvents: 0, acledEvents: 0 } };
  const key = points.map((p) => p.id).sort().join(",");
  if (cache && cache.key === key && Date.now() - cache.at < TTL) return cache.body;
  if (inflight && inflight.key === key) return inflight.p;
  const p = compute(points).then((body) => { cache = { at: Date.now(), key, body }; return body; })
    .finally(() => { if (inflight?.key === key) inflight = null; });
  inflight = { key, p };
  return p;
}

async function compute(points: Chokepoint[]): Promise<ChokepointReadsBody> {
  const today = new Date().toISOString().slice(0, 10);

  // Georeferenced events, from both conflict feeds. ACLED is the higher-fidelity
  // layer but its free tier embargoes recent data, so UCDP/ReliefWeb carries the
  // current picture — exactly the division the Crisis map already assumes.
  const [conflict, acled] = await Promise.all([
    getConflictPoints().catch(() => []),
    getAcledEvents().catch(() => []),
  ]);

  const events: GeoEvent[] = [
    ...conflict.map((c) => ({
      id: `ucdp-${c.name}-${c.lat},${c.lon}`,
      lat: c.lat, lon: c.lon,
      title: c.title || c.name,
      date: c.date,
      fatalities: c.count ?? null,
      source: c.src === "reliefweb" ? "ReliefWeb" : "UCDP",
    })),
    ...acled.map((a) => ({
      id: `acled-${a.id}`,
      lat: a.lat, lon: a.lon,
      title: `${a.subType || a.type}${a.location ? ` — ${a.location}` : ""}`,
      date: a.date,
      fatalities: a.fatalities ?? null,
      source: "ACLED",
    })),
  ];

  // One targeted news query per chokepoint, so the text being graded is
  // genuinely about that place rather than filtered out of a global pile.
  const signals: ChokepointRead[] = await Promise.all(points.map(async (cp) => {
    const news = await gdeltLocalNews(cp.name).catch(() => []);
    const texts: ChokepointText[] = news.map((n) => ({
      title: n.title, summary: n.summary, link: n.link, source: n.source, pubDate: n.pubDate,
    }));
    const read = readActivity(cp, texts, events, today);
    return {
      ...cp,
      ...read,
      // Cap the events actually shipped — the score already used all of them,
      // and a row needs a few examples, not fifty.
      events: read.events.slice(0, 6),
      totalEvents: read.events.length,
    };
  }));

  signals.sort((a, b) => b.score - a.score);
  return {
    signals,
    generatedAt: new Date().toISOString(),
    // So an all-zero board reads as "nothing interdiction-shaped reported",
    // never as "the straits are fine".
    sources: { conflictEvents: conflict.length, acledEvents: acled.length },
  };
}
