import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { fetchFeed } from "@/lib/rss";
import { readPrefs, sortByPreference } from "@/lib/articlePrefs";
import { getUserPrefs } from "@/lib/userPrefs";
import { BASE_NEWS_SOURCES, LOCAL_NEWS_SETS, isSourceEnabled } from "@/lib/newsSources";
import { recordDailySignals, topicTerms, watchTermsIn } from "@/lib/trends";
import { getActiveTrip } from "@/lib/trips";
import { syncCalendarTripsThrottled } from "@/lib/calendarTrips";
import { gdeltLocalNews } from "@/lib/localNews";
import { todayInTz } from "@/lib/date";
import type { NewsItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userPrefs = await getUserPrefs(normEmail(session.user?.email));
  // Home local feeds ALWAYS stay — even on a TDY trip you keep home news. The
  // trip gets its own "While you're at <place>" strip (tripNews, built below)
  // rather than replacing the home feed set.
  const today = todayInTz(userPrefs.timezone || "America/Chicago");
  // Auto-activate TDY from trip-like calendar events (throttled, best-effort) so
  // the strip follows you even without a hand-entered trip.
  await syncCalendarTripsThrottled(normEmail(session.user?.email), session.accessToken as string, today).catch(() => {});
  const activeTrip = await getActiveTrip(normEmail(session.user?.email), today).catch(() => null);
  const localFeedKey = userPrefs.localFeedKey ?? "colorado";
  const localFeeds = LOCAL_NEWS_SETS[localFeedKey] ?? LOCAL_NEWS_SETS.colorado;
  // Apply the user's disabled-source filter BEFORE fetching — disabling
  // a source means we skip the network round-trip entirely, not just hide
  // results in the UI. That's the token-and-bandwidth saver.
  const disabled = userPrefs.disabledNewsSources ?? [];
  const allFeeds = [...BASE_NEWS_SOURCES, ...localFeeds].filter((f) => isSourceEnabled(f.name, disabled));

  const [feedResults, prefs] = await Promise.all([
    Promise.all(allFeeds.map(({ url, name, category }) => fetchFeed(url, name, category))),
    readPrefs(normEmail(session.user?.email)),
  ]);

  const feedItems = feedResults.flatMap((r) => r.items);
  const byDate = feedItems.sort(
    (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );
  const items = sortByPreference(byDate, prefs, userPrefs.watchlist);

  // TDY news strip — genuinely-local coverage for the active trip, kept separate
  // from the home feed: curated regional feeds if the trip snapped to a base set,
  // plus keyless GDELT headlines for the trip city. Best-effort; never blocks.
  let tripNews: { label: string; items: NewsItem[] } | null = null;
  if (activeTrip) {
    const tripFeeds = (activeTrip.feedKey ? (LOCAL_NEWS_SETS[activeTrip.feedKey] ?? []) : [])
      .filter((f) => isSourceEnabled(f.name, disabled));
    const [tripFeedResults, gdelt] = await Promise.all([
      Promise.all(tripFeeds.map(({ url, name, category }) => fetchFeed(url, name, category))),
      gdeltLocalNews(activeTrip.label).catch(() => [] as NewsItem[]),
    ]);
    const seen = new Set<string>();
    const tripItems = [...tripFeedResults.flatMap((r) => r.items), ...gdelt]
      .filter((it) => { const k = it.link || it.id; if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, 12);
    if (tripItems.length) tripNews = { label: activeTrip.label, items: tripItems };
  }

  // Trend recorder (P1): count each article's topic/category/watch terms once
  // (signal_seen dedups the 15-min polling). Fire-and-forget — a trends fault
  // can never slow or break the news response.
  recordDailySignals(items.map((it) => ({
    id: `news|${it.link || it.id}`,
    terms: [
      ...topicTerms(it.title),
      { kind: "category" as const, term: it.category },
      ...watchTermsIn(`${it.title} ${it.summary ?? ""}`, userPrefs.watchlist ?? []),
    ],
  }))).catch(() => {});

  const sourceErrors: Record<string, string> = {};
  for (const result of feedResults) {
    if (!result.ok && result.error) sourceErrors[result.source] = result.error;
  }

  // Per-source aggregates the Preferences UI uses to show volume and a
  // rough token estimate next to each toggle. `totalChars` covers what a
  // threads / briefing prompt would carry (title + summary); the client
  // divides by ~4 to ballpark tokens. This isn't a guarantee of saved
  // tokens — the AI routes cap at 20-40 articles each, so disabling a
  // source only reduces real input-token cost once total volume drops
  // below the cap. That nuance is documented in the editor's help text.
  const sourceStats: { name: string; count: number; totalChars: number }[] = [];
  const seenForStats = new Map<string, { count: number; chars: number }>();
  for (const r of feedResults) {
    const agg = seenForStats.get(r.source) ?? { count: 0, chars: 0 };
    for (const it of r.items) {
      agg.count++;
      agg.chars += (it.title?.length ?? 0) + (it.summary?.length ?? 0);
    }
    seenForStats.set(r.source, agg);
  }
  for (const [name, { count, chars }] of seenForStats) {
    sourceStats.push({ name, count, totalChars: chars });
  }

  return NextResponse.json(
    {
      items,
      tripNews,
      sourceErrors: Object.keys(sourceErrors).length ? sourceErrors : undefined,
      sourceStats,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
