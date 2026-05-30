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

  return NextResponse.json(
    { items, sourceErrors: Object.keys(sourceErrors).length ? sourceErrors : undefined },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
