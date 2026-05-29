import type { OsintFeed } from "./types";

// Curated starter set for the OSINT Feeds editor. Surfaced as a one-click
// "💡 Suggestions" panel under the editor — click + to add, with the URL
// pre-filled to a known-working pattern (mostly Telegram bridges via
// rsshub.app since Telegram doesn't aggressively block scrapers the way
// Twitter does).
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
      { label: "Reuters World",  url: "https://rsshub.app/telegram/channel/reuters",            kind: "news" },
      { label: "BBC World",      url: "https://rsshub.app/telegram/channel/bbcworld",           kind: "news" },
      { label: "AFP",            url: "https://rsshub.app/telegram/channel/afpnewsagency",      kind: "news" },
      { label: "Al Jazeera EN",  url: "https://rsshub.app/telegram/channel/aljazeeraenglish",   kind: "news" },
    ],
  },
  {
    name: "OSINT aggregators (English)",
    description: "Multi-conflict OSINT analysts. High signal, mixed quality — verify before citing.",
    feeds: [
      { label: "WarMonitor",       url: "https://rsshub.app/telegram/channel/WarMonitor3",   kind: "telegram" },
      { label: "ELINT News",       url: "https://rsshub.app/telegram/channel/ELINTNews",     kind: "telegram" },
      { label: "LiveUAMap",        url: "https://rsshub.app/telegram/channel/liveuamap",     kind: "telegram" },
      { label: "OSINT Defender",   url: "https://rsshub.app/telegram/channel/OSINTdefender", kind: "telegram", note: "If sentdefender has a TG mirror it lives at this slug" },
    ],
  },
  {
    name: "Russian milblogger ecosystem",
    description: "Adversary perspective. Propaganda vectors AND primary-source situational data simultaneously — consume with that framing.",
    feeds: [
      { label: "Rybar",         url: "https://rsshub.app/telegram/channel/rybar",      kind: "telegram", bias: "Russian-aligned" },
      { label: "Intel Slava Z", url: "https://rsshub.app/telegram/channel/intelslava", kind: "telegram", bias: "Russian-aligned" },
      { label: "Voenacher",     url: "https://rsshub.app/telegram/channel/voenacher",  kind: "telegram", bias: "Russian-aligned" },
    ],
  },
  {
    name: "Ukraine POV",
    description: "English-language Ukrainian sources.",
    feeds: [
      { label: "Kyiv Independent", url: "https://rsshub.app/telegram/channel/KyivIndependent", kind: "telegram", bias: "Pro-Ukraine" },
      { label: "Kyiv Post",        url: "https://rsshub.app/telegram/channel/kyivpost",        kind: "telegram", bias: "Pro-Ukraine" },
    ],
  },
  {
    name: "Middle East",
    feeds: [
      { label: "Quds News",            url: "https://rsshub.app/telegram/channel/QudsNen",   kind: "telegram", bias: "Palestinian POV" },
      { label: "Palestinian Info Ctr", url: "https://rsshub.app/telegram/channel/palinfoen", kind: "telegram", bias: "Palestinian POV" },
    ],
  },
  {
    name: "Aviation tracking",
    feeds: [
      { label: "ItaMilRadar", url: "https://rsshub.app/telegram/channel/ItaMilRadar", kind: "telegram", note: "Italian-based mil aviation monitoring" },
    ],
  },
  {
    name: "Defense / official",
    feeds: [
      { label: "UK Ministry of Defence", url: "https://rsshub.app/telegram/channel/defencehq", kind: "telegram" },
    ],
  },
  {
    name: "Think tanks / research",
    feeds: [
      { label: "Institute for Study of War", url: "https://rsshub.app/telegram/channel/ISWresearch", kind: "telegram", bias: "Western" },
    ],
  },
  {
    name: "Cyber-conflict",
    feeds: [
      { label: "CyberKnow", url: "https://rsshub.app/telegram/channel/cyberknow", kind: "telegram", note: "Cyber-conflict OSINT analyst" },
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
