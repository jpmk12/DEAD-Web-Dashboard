// Centralised catalog of news sources. Both /api/news (server-side fetch) and
// the Preferences UI (toggle list) reference this single source of truth.
//
// Disabling a source via Preferences → Content sources skips the fetch
// entirely (no bandwidth, no parsing, no items contributing to AI context
// in News chat / threads / briefings).
//
// IDs default to `name` since names are unique within this catalog. If two
// local sets share a name (e.g. "Stars & Stripes" in japan + germany),
// one toggle covers both — desired behaviour for the user.

export interface NewsSource {
  url: string;
  name: string;
  category: "overview" | "defense" | "strategic" | "domestic" | "space" | "local";
}

// Always-on (non-local) sources. Disable any via user prefs.
export const BASE_NEWS_SOURCES: NewsSource[] = [
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
  // RAND's old /pubs/rss/randall.xml now 404s (feed was retired/moved); removed
  // to stop the recurring fetch error. Re-add when a current RAND RSS URL is known.
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

// Local sets keyed by the user's localFeedKey pref.
export const LOCAL_NEWS_SETS: Record<string, NewsSource[]> = {
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

// All sources the user might see, across all local sets. Used by the
// Preferences UI to render the toggle list — irrespective of their current
// localFeedKey, the user sees every named source they could ever encounter.
// Deduped by name so "Stars & Stripes" (japan + germany) only appears once.
export function allKnownNewsSources(): NewsSource[] {
  const seen = new Set<string>();
  const out: NewsSource[] = [];
  for (const s of BASE_NEWS_SOURCES) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
  }
  for (const set of Object.values(LOCAL_NEWS_SETS)) {
    for (const s of set) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      out.push(s);
    }
  }
  return out;
}

// Skip filter consulted by /api/news. The pref stores a list of disabled
// source names; the route excludes those before fetching.
export function isSourceEnabled(name: string, disabled: string[] | undefined): boolean {
  if (!disabled || disabled.length === 0) return true;
  return !disabled.includes(name);
}
