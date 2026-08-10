import type { OsintFeed } from "./types";

// Curated starter set for the OSINT Feeds editor. Surfaced as a one-click
// "💡 Suggestions" panel under the editor — click + to add, with the URL
// pre-filled to a known-working pattern. Telegram channels use their own
// public preview page (https://t.me/s/<slug>), which the feed route parses
// directly — far more reliable than the old rsshub.app bridge, which was
// chronically rate-limited / IP-blocked from datacenter hosts. (The route
// still transparently handles any legacy rsshub URLs already saved in prefs.)
//
// Social: X/Twitter is intentionally absent. X killed free API access and
// blocks scrapers/datacenter IPs, so RSSHub/Nitter bridges to it are dead. The
// OSINT community largely moved to Bluesky + Mastodon (both expose NATIVE RSS:
// bsky.app/profile/<handle>/rss and <instance>/@user.rss) and Reddit
// (reddit.com/r/<sub>/.rss) — all keyless, HTTPS, and not bridge-dependent, so
// they work from this host. These carry kind "social" so they populate the
// repurposed Social pane.
//
// Curation principles:
// - Diverse perspective on purpose: news wires, OSINT analysts, adversary-
//   POV milbloggers, regional sources, official defence accounts. An analyst
//   wants the full picture including hostile narrative sources.
// - Bias is labelled, not hidden. The `bias` field renders inline so the
//   user sees the slant when they add the feed.
// - Slugs/handles are best-effort — I can't reach these hosts from the build
//   env to verify, so the editor's Test button is the user's verification path.
//   A handle that returns 0 items is renamed/wrong; the URL patterns above make
//   it easy to swap in the correct one.

export interface OsintFeedSuggestion {
  label: string;
  url: string;
  kind: OsintFeed["kind"];
  bias?: string;
  note?: string;
}

export interface OsintFeedSuggestionGroup {
  name: string;
  description?: string;
  feeds: OsintFeedSuggestion[];
}

export const OSINT_FEED_SUGGESTIONS: OsintFeedSuggestionGroup[] = [
  {
    name: "News wires",
    description: "High-volume, editorially vetted. Good baseline coverage.",
    feeds: [
      { label: "Reuters World",  url: "https://t.me/s/reuters",            kind: "news" },
      { label: "BBC World",      url: "https://t.me/s/bbcworld",           kind: "news" },
      { label: "AFP",            url: "https://t.me/s/afpnewsagency",      kind: "news" },
      { label: "Al Jazeera EN",  url: "https://t.me/s/aljazeeraenglish",   kind: "news" },
    ],
  },
  {
    name: "Bluesky (native RSS — no bridge)",
    description: "Where much of the OSINT / journalist community moved after X. Native RSS at bsky.app/profile/<handle>/rss — keyless and not rate-limited. Handles are best-effort (many orgs use a custom-domain handle); verify with Test and swap if 0 items.",
    feeds: [
      { label: "Bellingcat",       url: "https://bsky.app/profile/bellingcat.com/rss",    kind: "social", note: "Custom-domain handle bellingcat.com" },
      { label: "AP News",          url: "https://bsky.app/profile/apnews.com/rss",        kind: "social" },
      { label: "NPR",              url: "https://bsky.app/profile/npr.org/rss",           kind: "social" },
      { label: "The Guardian",     url: "https://bsky.app/profile/theguardian.com/rss",   kind: "social" },
    ],
  },
  {
    name: "Reddit (native RSS — no bridge)",
    description: "Subreddit feeds at reddit.com/r/<sub>/.rss. Durable sub names, keyless. (Reddit rate-limits datacenter IPs — if a feed is empty, Test reveals a 429 and it usually recovers on the next cycle.)",
    feeds: [
      { label: "r/geopolitics",        url: "https://www.reddit.com/r/geopolitics/.rss",          kind: "social" },
      { label: "r/CredibleDefense",    url: "https://www.reddit.com/r/CredibleDefense/.rss",      kind: "social" },
      { label: "r/LessCredibleDefence",url: "https://www.reddit.com/r/LessCredibleDefence/.rss",  kind: "social" },
      { label: "r/CombatFootage",      url: "https://www.reddit.com/r/CombatFootage/.rss",        kind: "social", note: "Graphic — primary-source video" },
      { label: "r/UkraineWarVideoRpt", url: "https://www.reddit.com/r/UkraineWarVideoReport/.rss",kind: "social", bias: "Pro-Ukraine" },
      { label: "r/OSINT",              url: "https://www.reddit.com/r/OSINT/.rss",                kind: "social" },
      { label: "r/syriancivilwar",     url: "https://www.reddit.com/r/syriancivilwar/.rss",       kind: "social" },
    ],
  },
  {
    name: "Mastodon (native RSS — no bridge)",
    description: "Any Mastodon account exposes RSS by appending .rss to its profile URL: https://<instance>/@<user>.rss. Federated, so the instance host matters. Best-effort handles below — find others on your home instance and add via that pattern.",
    feeds: [
      { label: "Bellingcat",  url: "https://mastodon.social/@bellingcat.rss",  kind: "social", note: "If empty, search their current instance" },
    ],
  },
  {
    name: "OSINT aggregators (English)",
    description: "Multi-conflict OSINT analysts. High signal, mixed quality — verify before citing.",
    feeds: [
      { label: "WarMonitor",       url: "https://t.me/s/WarMonitor3",   kind: "telegram" },
      { label: "ELINT News",       url: "https://t.me/s/ELINTNews",     kind: "telegram" },
      { label: "LiveUAMap",        url: "https://t.me/s/liveuamap",     kind: "telegram" },
      { label: "OSINT Defender",   url: "https://t.me/s/OSINTdefender", kind: "telegram", note: "If sentdefender has a TG mirror it lives at this slug" },
    ],
  },
  {
    name: "Russian milblogger ecosystem",
    description: "Adversary perspective. Propaganda vectors AND primary-source situational data simultaneously — consume with that framing.",
    feeds: [
      { label: "Rybar",         url: "https://t.me/s/rybar",      kind: "telegram", bias: "Russian-aligned" },
      { label: "Intel Slava Z", url: "https://t.me/s/intelslava", kind: "telegram", bias: "Russian-aligned" },
      { label: "Voenacher",     url: "https://t.me/s/voenacher",  kind: "telegram", bias: "Russian-aligned" },
    ],
  },
  {
    name: "Ukraine POV",
    description: "English-language Ukrainian sources.",
    feeds: [
      { label: "Kyiv Independent", url: "https://t.me/s/KyivIndependent", kind: "telegram", bias: "Pro-Ukraine" },
      { label: "Kyiv Post",        url: "https://t.me/s/kyivpost",        kind: "telegram", bias: "Pro-Ukraine" },
    ],
  },
  {
    name: "Middle East",
    feeds: [
      { label: "Quds News",            url: "https://t.me/s/QudsNen",   kind: "telegram", bias: "Palestinian POV" },
      { label: "Palestinian Info Ctr", url: "https://t.me/s/palinfoen", kind: "telegram", bias: "Palestinian POV" },
    ],
  },
  {
    name: "Aviation tracking",
    feeds: [
      { label: "ItaMilRadar", url: "https://t.me/s/ItaMilRadar", kind: "telegram", note: "Italian-based mil aviation monitoring" },
    ],
  },
  {
    name: "Defense / official",
    feeds: [
      { label: "UK Ministry of Defence", url: "https://t.me/s/defencehq", kind: "telegram" },
    ],
  },
  {
    name: "Think tanks / research",
    feeds: [
      { label: "Institute for Study of War", url: "https://t.me/s/ISWresearch", kind: "telegram", bias: "Western" },
    ],
  },
  {
    name: "Cyber-conflict",
    feeds: [
      { label: "CyberKnow", url: "https://t.me/s/cyberknow", kind: "telegram", note: "Cyber-conflict OSINT analyst" },
    ],
  },
  {
    name: "Native RSS (no bridge required)",
    description: "Native publisher feeds — most durable since they don't rely on third-party scrapers.",
    feeds: [
      { label: "BBC World",     url: "https://feeds.bbci.co.uk/news/world/rss.xml",    kind: "news" },
      { label: "Al Jazeera",    url: "https://www.aljazeera.com/xml/rss/all.xml",      kind: "news" },
      { label: "Defense News",  url: "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", kind: "news" },
    ],
  },
];

// Which suggestion groups speak to which theater — so the Sources pane can
// lead with feeds relevant to the user's declared AO (Mission Profile
// theaters + AOI AORs) instead of a fixed order. Groups not listed are
// theater-agnostic and keep their catalog order after the AO groups.
const AOR_GROUP_AFFINITY: Record<string, string[]> = {
  CENTCOM: ["Middle East", "OSINT aggregators (English)"],
  EUCOM: ["Ukraine POV", "Russian milblogger ecosystem"],
  INDOPACOM: ["OSINT aggregators (English)", "Think tanks / research"],
  AFRICOM: ["News wires", "OSINT aggregators (English)"],
};

export function suggestionGroupsForAors(aors: string[]): { groups: OsintFeedSuggestionGroup[]; aoLed: boolean } {
  const wanted: string[] = [];
  for (const aor of aors) for (const g of AOR_GROUP_AFFINITY[aor] ?? []) {
    if (!wanted.includes(g)) wanted.push(g);
  }
  if (!wanted.length) return { groups: OSINT_FEED_SUGGESTIONS, aoLed: false };
  const lead = wanted
    .map((name) => OSINT_FEED_SUGGESTIONS.find((g) => g.name === name))
    .filter((g): g is OsintFeedSuggestionGroup => g != null);
  const rest = OSINT_FEED_SUGGESTIONS.filter((g) => !wanted.includes(g.name));
  return { groups: [...lead, ...rest], aoLed: true };
}
