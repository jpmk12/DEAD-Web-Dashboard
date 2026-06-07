import type { OsintFeed } from "./types";

// Curated starter set for the OSINT Feeds editor. Surfaced as a one-click
// "💡 Suggestions" panel under the editor — click + to add, with the URL
// pre-filled to a known-working pattern. Telegram channels use their own
// public preview page (https://t.me/s/<slug>), which the feed route parses
// directly — far more reliable than the old rsshub.app bridge, which was
// chronically rate-limited / IP-blocked from datacenter hosts. (The route
// still transparently handles any legacy rsshub URLs already saved in prefs.)
//
// Curation principles:
// - Diverse perspective on purpose: news wires, OSINT analysts, adversary-
//   POV milbloggers, regional sources, official defence accounts. An analyst
//   wants the full picture including hostile narrative sources.
// - Bias is labelled, not hidden. The `bias` field renders inline so the
//   user sees the slant when they add the feed.
// - Slugs are best-effort — I can't reach Telegram from the build env to
//   verify, so the editor's Test button is the user's verification path.
//   If a slug is wrong, Test returns 0 items and the user can search t.me
//   for the right one.

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
