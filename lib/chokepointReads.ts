// Chokepoint interdiction reads — server-only, shared by the Economy tab's
// route and the demand horizon. Extracted from /api/markets/chokepoints so
// the horizon can read the straits without an HTTP hop; the 15-min cache
// keyed on the requested set moved with it.

import { CHOKEPOINTS, type Chokepoint } from "./chokepoints";
import { readActivity, type GeoEvent, type ChokepointText, type ActivityRead } from "./chokepointSignals";
import { getConflictPoints } from "./conflictEvents";
import { getAcledEvents } from "./acled";
import { gdeltLocalNewsLive } from "./localNews";
import { ensureChokepointConnection, type AisStatus } from "./aisStream";
import { getChokepointTransits, type ChokepointTransit } from "./chokepointAis";
import { getSensorSeries, recordSensorDay } from "./sensorStore";
import { sensorKey } from "./sensorKeys";
import { precedes, type LeadResult } from "./series";

export interface ChokepointRead extends Chokepoint, ActivityRead {
  totalEvents: number;
  /** Live AIS transit picture (what ships DO), attached at read time — not
   *  part of the 15-min cached text/event read. Absent for non-maritime
   *  chokepoints. */
  transit?: ChokepointTransit;
  /** Do suppressed transits precede reported acts here? (lib/series.precedes
   *  over the cpact: series; null below three acts on record.) */
  transitLead?: LeadResult | null;
}

export interface ChokepointReadsBody {
  signals: ChokepointRead[];
  generatedAt: string;
  sources: { conflictEvents: number; acledEvents: number };
  /** AIS bridge status — so an all-UNKNOWN transit column can be explained. */
  ais?: AisStatus;
}

const TTL = 15 * 60 * 1000;
let cache: { at: number; key: string; body: ChokepointReadsBody } | null = null;
let inflight: { key: string; p: Promise<ChokepointReadsBody> } | null = null;

export async function getChokepointReads(ids?: string[]): Promise<ChokepointReadsBody> {
  const points = ids?.length ? CHOKEPOINTS.filter((c) => ids.includes(c.id)) : CHOKEPOINTS;
  if (points.length === 0) return { signals: [], generatedAt: new Date().toISOString(), sources: { conflictEvents: 0, acledEvents: 0 }, ais: { configured: false, connected: false } };
  const key = points.map((p) => p.id).sort().join(",");
  let body: ChokepointReadsBody;
  if (cache && cache.key === key && Date.now() - cache.at < TTL) body = cache.body;
  else if (inflight && inflight.key === key) body = await inflight.p;
  else {
    const p = compute(points).then((b) => { cache = { at: Date.now(), key, body: b }; return b; })
      .finally(() => { if (inflight?.key === key) inflight = null; });
    inflight = { key, p };
    body = await p;
  }
  return withTransits(body);
}

// Every read keeps the AIS bridge alive (chokepoint boxes only, unless a map
// already holds a home subscription) and attaches the live transit picture.
// The text/event read is cached; the transit numbers are always current.
async function withTransits(body: ChokepointReadsBody): Promise<ChokepointReadsBody> {
  const ais = ensureChokepointConnection();
  const transits = await getChokepointTransits({ configured: ais.configured, connected: ais.connected }).catch(() => ({} as Record<string, ChokepointTransit>));
  const actDays = await actDaysFor(body.signals.map((s) => s.id));
  return {
    ...body,
    ais,
    signals: body.signals.map((s) => {
      const t = transits[s.id];
      if (!t) return s;
      const acts = actDays[s.id] ?? [];
      return { ...s, transit: t, transitLead: precedes(t.suppressedDays, acts, TRANSIT_LEAD_LAG_DAYS) };
    }),
  };
}

/** Prior days with a reported act at each chokepoint (the cpact: series),
 *  cached 10 min — one small query per strait per refresh otherwise. */
export const TRANSIT_LEAD_LAG_DAYS = 3;
let actCache: { at: number; key: string; days: Record<string, string[]> } | null = null;
async function actDaysFor(ids: string[]): Promise<Record<string, string[]>> {
  // Keyed by the id set: an I&W sensor asking for one strait must not leave
  // the Economy tab's eight-strait read with empty act histories.
  const key = [...ids].sort().join(",");
  if (actCache && actCache.key === key && Date.now() - actCache.at < 10 * 60_000) return actCache.days;
  const days: Record<string, string[]> = {};
  await Promise.all(ids.map(async (id) => {
    const series = await getSensorSeries(sensorKey("cpact", id), 90).catch(() => []);
    days[id] = series.filter((p) => p.value >= 1).map((p) => p.day);
  }));
  actCache = { at: Date.now(), key, days };
  return days;
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
    const { items: news, live: newsLive } = await gdeltLocalNewsLive(cp.name).catch(() => ({ items: [], live: false }));
    const texts: ChokepointText[] = news.map((n) => ({
      title: n.title, summary: n.summary, link: n.link, source: n.source, pubDate: n.pubDate,
    }));
    const read = readActivity(cp, texts, events, today);
    // The act history that did not exist before (PLAN §5 C3): 1 on a day the
    // graded read holds a reported act, 0 otherwise — an observed quiet day
    // is a fact too, but ONLY when the news feed answered: a dead sensor
    // writes nothing (code review 2026-10-07). Day-peak, fire-and-forget.
    if (newsLive || read.acts > 0) recordSensorDay(sensorKey("cpact", cp.id), today, read.acts > 0 ? 1 : 0).catch(() => {});
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
