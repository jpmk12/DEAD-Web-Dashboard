import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { CHOKEPOINTS } from "@/lib/chokepoints";
import { readActivity, type GeoEvent, type ChokepointText } from "@/lib/chokepointSignals";
import { getConflictPoints } from "@/lib/conflictEvents";
import { getAcledEvents } from "@/lib/acled";
import { gdeltLocalNews } from "@/lib/localNews";

export const dynamic = "force-dynamic";

// Chokepoint interdiction, graded rather than counted.
//
// The old surface counted keyword mentions, so a tanker struck by a missile and
// an op-ed about the strait scored the same. This joins two things the app
// already holds and had never compared — chokepoint coordinates and
// georeferenced conflict events — and grades the text by MOOD so a declared act
// outranks a declared intention, which outranks somebody's think piece.
//
// Every source is already cached: getConflictPoints (30 min), getAcledEvents
// (its own cache + cookie session), and one GDELT query per chokepoint the
// caller asks about. No model call.

const TTL = 15 * 60 * 1000;
let cache: { at: number; key: string; body: unknown } | null = null;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Which chokepoints to read. The Economy tab asks for all; the I&W sensors
  // ask for the one their board watches, so a board never pays for eight.
  const want = new URL(req.url).searchParams.get("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const points = want?.length
    ? CHOKEPOINTS.filter((c) => want.includes(c.id))
    : CHOKEPOINTS;
  if (points.length === 0) return NextResponse.json({ signals: [] });

  const key = points.map((p) => p.id).sort().join(",");
  if (cache && cache.key === key && Date.now() - cache.at < TTL) {
    return NextResponse.json({ ...(cache.body as object), cached: true });
  }

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
  const signals = await Promise.all(points.map(async (cp) => {
    const news = await gdeltLocalNews(cp.name).catch(() => []);
    const texts: ChokepointText[] = news.map((n) => ({
      title: n.title, summary: n.summary, link: n.link, source: n.source, pubDate: n.pubDate,
    }));
    const read = readActivity(cp, texts, events, today);
    return {
      id: cp.id, name: cp.name, lat: cp.lat, lon: cp.lon, why: cp.why,
      radiusKm: cp.radiusKm,
      ...read,
      // Cap the events actually shipped to the client — the score already used
      // all of them, and a row needs a few examples, not fifty.
      events: read.events.slice(0, 6),
      totalEvents: read.events.length,
    };
  }));

  signals.sort((a, b) => b.score - a.score);
  const body = {
    signals,
    generatedAt: new Date().toISOString(),
    // So an all-zero board reads as "nothing interdiction-shaped reported",
    // never as "the straits are fine".
    sources: { conflictEvents: conflict.length, acledEvents: acled.length },
  };
  cache = { at: Date.now(), key, body };
  return NextResponse.json(body);
}
