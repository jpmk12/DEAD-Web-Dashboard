import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchFeed } from "@/lib/rss";
import { readPrefs, sortByPreference } from "@/lib/articlePrefs";
import { getUserPrefs } from "@/lib/userPrefs";
import { BASE_NEWS_SOURCES, LOCAL_NEWS_SETS, isSourceEnabled } from "@/lib/newsSources";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userPrefs = await getUserPrefs();
  const localFeedKey = userPrefs.localFeedKey ?? "colorado";
  const localFeeds = LOCAL_NEWS_SETS[localFeedKey] ?? LOCAL_NEWS_SETS.colorado;
  // Apply the user's disabled-source filter BEFORE fetching — disabling
  // a source means we skip the network round-trip entirely, not just hide
  // results in the UI. That's the token-and-bandwidth saver.
  const disabled = userPrefs.disabledNewsSources ?? [];
  const allFeeds = [...BASE_NEWS_SOURCES, ...localFeeds].filter((f) => isSourceEnabled(f.name, disabled));

  const [feedResults, prefs] = await Promise.all([
    Promise.all(allFeeds.map(({ url, name, category }) => fetchFeed(url, name, category))),
    readPrefs(),
  ]);

  const allItems = feedResults.flatMap((r) => r.items);
  const byDate = allItems.sort(
    (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );
  const items = sortByPreference(byDate, prefs, userPrefs.watchlist);

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
      sourceErrors: Object.keys(sourceErrors).length ? sourceErrors : undefined,
      sourceStats,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
