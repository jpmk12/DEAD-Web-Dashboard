import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchFeed } from "@/lib/rss";
import { readPrefs, sortByPreference } from "@/lib/articlePrefs";
import { getUserPrefs } from "@/lib/userPrefs";

type Feed = { url: string; name: string; category: string };

// Non-local feeds — always included
const BASE_FEEDS: Feed[] = [
  // Overview — broad national security / current events
  { url: "https://www.dvidshub.net/rss/news",                                   name: "DVIDS",                  category: "overview" },
  { url: "https://thehill.com/rss/syndicator/19110/feed/",                       name: "The Hill",               category: "overview" },
  { url: "https://rss.cnn.com/rss/edition.rss",                                  name: "CNN",                    category: "overview" },

  // Defense — operations, hardware, DoD
  { url: "https://breakingdefense.com/feed/",                                    name: "Breaking Defense",       category: "defense" },
  { url: "https://www.airforcemag.com/feed/",                                    name: "Air Force Magazine",     category: "defense" },
  { url: "https://news.usni.org/feed",                                           name: "USNI News",              category: "defense" },
  { url: "https://taskandpurpose.com/feed/",                                     name: "Task & Purpose",         category: "defense" },
  { url: "https://www.thedrive.com/the-war-zone/rss",                            name: "The War Zone",           category: "defense" },
  { url: "https://www.defensenews.com/arc/outboundfeeds/rss/",                   name: "Defense News",           category: "defense" },

  // Strategic — think-tank, policy, long-form analysis
  { url: "https://warontherocks.com/feed/",                                      name: "War on the Rocks",       category: "strategic" },
  { url: "https://www.rand.org/pubs/rss/randall.xml",                            name: "RAND",                   category: "strategic" },
  { url: "https://www.foreignaffairs.com/rss.xml",                               name: "Foreign Affairs",        category: "strategic" },
  { url: "https://www.theatlantic.com/feed/all/",                                name: "The Atlantic",           category: "strategic" },
  { url: "https://www.scmp.com/rss/91/feed",                                     name: "South China Morning Post", category: "strategic" },

  // Domestic — Congress, budget, politics
  { url: "https://rollcall.com/feed/",                                           name: "Roll Call",              category: "domestic" },
  { url: "https://thehill.com/rss/syndicator/19109/feed/",                       name: "The Hill Congress",      category: "domestic" },

  // Space — Space Force, commercial, launch
  { url: "https://spacenews.com/feed/",                                          name: "SpaceNews",              category: "space" },
  { url: "https://www.nasaspaceflight.com/feed/",                                name: "NASASpaceFlight",        category: "space" },
];

// Local feeds keyed by user pref location
const LOCAL_FEED_SETS: Record<string, Feed[]> = {
  colorado: [
    { url: "https://coloradosun.com/feed/",                   name: "Colorado Sun",         category: "local" },
    { url: "https://www.9news.com/feeds/syndication/rss/news/", name: "9NEWS Denver",       category: "local" },
  ],
  dc: [
    { url: "https://wtop.com/feed/",                          name: "WTOP DC",              category: "local" },
    { url: "https://dcist.com/feed/",                         name: "DCist",                category: "local" },
  ],
  hampton_roads: [
    { url: "https://www.pilotonline.com/feed/",               name: "Virginian-Pilot",      category: "local" },
    { url: "https://wavy.com/feed/",                          name: "WAVY News",            category: "local" },
  ],
  san_antonio: [
    { url: "https://www.expressnews.com/rss/feeds/news/",     name: "SA Express-News",      category: "local" },
    { url: "https://www.texastribune.org/feed/",              name: "Texas Tribune",         category: "local" },
  ],
  hawaii: [
    { url: "https://www.civilbeat.org/feed/",                 name: "Civil Beat Hawaii",    category: "local" },
    { url: "https://www.khon2.com/feed/",                     name: "KHON2 Hawaii",         category: "local" },
  ],
  japan: [
    { url: "https://www.stripes.com/feed/",                   name: "Stars & Stripes",      category: "local" },
    { url: "https://english.kyodonews.net/rss/news.xml",      name: "Kyodo News",           category: "local" },
  ],
  germany: [
    { url: "https://www.stripes.com/feed/",                   name: "Stars & Stripes",      category: "local" },
    { url: "https://www.thelocal.de/feed/",                   name: "The Local Germany",    category: "local" },
  ],
  illinois: [
    { url: "https://chicago.suntimes.com/rss",                name: "Chicago Sun-Times",    category: "local" },
    { url: "https://blockclubchicago.org/feed/",              name: "Block Club Chicago",   category: "local" },
  ],
  oklahoma: [
    { url: "https://oklahomawatch.org/feed/",                 name: "Oklahoma Watch",       category: "local" },
    { url: "https://www.tulsaworld.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc", name: "Tulsa World", category: "local" },
  ],
  new_jersey: [
    { url: "https://www.nj.com/arcio/rss/category/news/",     name: "NJ.com",               category: "local" },
    { url: "https://njspotlightnews.org/feed/",               name: "NJ Spotlight",         category: "local" },
  ],
};

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read user prefs first (fast local file) to determine which local feeds to use
  const userPrefs = await getUserPrefs();
  const localFeedKey = userPrefs.localFeedKey ?? "colorado";
  const localFeeds = LOCAL_FEED_SETS[localFeedKey] ?? LOCAL_FEED_SETS.colorado;
  const allFeeds = [...BASE_FEEDS, ...localFeeds];

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
