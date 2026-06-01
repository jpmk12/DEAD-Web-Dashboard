export interface NewsItem {
  id: string;
  title: string;
  source: string;
  category: string; // "overview" | "defense" | "strategic" | "domestic" | "space" | "local"
  pubDate: string;
  summary: string;
  link: string;
  imageUrl?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  isAllDay: boolean;
  account?: string;        // email address of the Google account this event belongs to
  attendees?: string[];    // lowercased emails of non-self attendees (used by meeting prep)
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type EmailPriority = "High" | "Medium" | "Low";

export interface EmailMessage {
  id: string;
  account: "primary" | "secondary";
  accountEmail: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  bodyPreview: string;
  priority: EmailPriority;
  summary: string;
}

export interface NewsletterSummary {
  id: string;
  subject: string;
  date: string;
  bullets: string[];
  source: "politico" | "dow" | "merge" | "asf";
  account: "primary" | "secondary";
  accountEmail: string;
}

export interface SavedItem {
  id: string;
  type: "article" | "newsletter-bullet";
  title: string;
  content: string;
  source: string;
  link?: string;
  savedAt: string;
}

export type AppTheme = "nightwatch" | "amber" | "arctic" | "mission";

export interface UserPrefs {
  role: string;
  priorityTopics: string[];
  deprioritizeTopics: string[];
  watchlist: string[];
  // Email triage overrides. Each entry is either a full email
  // (`john@example.com`) or a bare domain (`example.com`); domain rules
  // also match subdomains. Applied deterministically after Claude
  // classification — see app/api/gmail/route.ts.
  vipSenders: string[];   // force priority = High
  muteSenders: string[];  // force priority = Low
  // Sender suggestions the user has explicitly dismissed; never re-suggest.
  dismissedVipSuggestions: string[];
  // Weather tab — additional locations the user wants tracked alongside the
  // home location. Each has a stable id + display label + coords.
  trackedLocations: TrackedLocation[];
  // Markets tab — custom ticker watchlist. TradingView symbol format,
  // e.g. "NYSE:LMT", "NASDAQ:CACI", "NYMEX:CL1!".
  marketsWatchlist: TickerEntry[];
  // OSINT tab — configurable RSS feed sources (social media bridges, news,
  // niche curated feeds). Each entry is a labelled URL.
  osintFeeds: OsintFeed[];
  // News sources the user has toggled off — names as listed in
  // lib/newsSources.ts. Skipped before fetch, so disabling reduces both
  // bandwidth and AI context size for news_chat / threads / briefing.
  disabledNewsSources: string[];
  // AI controls — master switch + per-feature overrides. When master is off,
  // every Claude-calling route returns its graceful fallback regardless of
  // per-feature settings. Per-feature is opt-out: missing key = enabled.
  aiEnabled: boolean;
  aiFeatureToggles: Partial<Record<AiFeature, boolean>>;
  localFeedKey: string;   // determines which RSS feeds show in "local" tab
  localZipcode: string;   // raw zipcode entered by user (5-digit US or OCONUS key)
  localCity: string;      // resolved display name e.g. "Colorado Springs, CO"
  localLat: number | null;
  localLon: number | null;
  theme: AppTheme;
  timezone: string;  // IANA timezone e.g. "America/Chicago"
  lastUpdated: string;
}

export interface TrackedLocation {
  id: string;
  label: string;
  lat: number;
  lon: number;
}

export interface TickerEntry {
  symbol: string;  // e.g. "NYSE:LMT"
  label: string;   // e.g. "Lockheed Martin"
}

export interface OsintFeed {
  id: string;
  label: string;
  url: string;
  kind: "social" | "telegram" | "news" | "other";
}

export type AiFeature =
  | "chat"           // /api/chat
  | "news_chat"      // /api/news-chat
  | "email_triage"   // /api/gmail Claude classification
  | "email_actions"  // /api/gmail/actions
  | "osint_triage"   // /api/osint/triage
  | "osint_situation"// /api/osint/situation
  | "doc_chat"       // /api/documents/chat
  | "newsletters"    // /api/newsletters
  | "briefing"       // /api/briefing
  | "digest"         // /api/digest
  | "threads"        // /api/threads
  | "news_overview"  // /api/news/curated
  | "quick_capture"  // /api/quick-capture
  | "memory";        // background memory consolidation

export interface AiUsageRow {
  id: number;
  route: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costMicros: number;   // micro-USD; divide by 1e6 for USD
  createdAt: number;    // ms epoch
}

export interface AiUsageSummary {
  totalMicros: number;
  totalCalls: number;
  byRoute: { route: string; micros: number; calls: number }[];
  byModel: { model: string; micros: number; calls: number }[];
}

// Forecast / alerts / space-weather payloads returned by the weather APIs.
export interface ForecastPeriod {
  name: string;
  startTime: string;
  isDaytime: boolean;
  tempF: number;
  tempTrend?: string | null;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  icon: string;
  precipPercent?: number | null;
}

export interface WeatherAlert {
  id: string;
  event: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  urgency: string;
  headline: string;
  effective: string;
  expires: string;
  areaDesc: string;
}

export interface SpaceWeather {
  // Kp index — 0 quiet, 5 G1 storm, 9 G5 extreme.
  currentKp: number | null;
  kpHistory: { time: string; value: number }[];
  // X-ray flare class string ("Quiet" / "A" / "B" / "C5.0" / "M2.3" / "X1.0").
  currentFlareClass: string;
  // NOAA scales (G/S/R) derived from current conditions.
  geoStorm: string;        // G0..G5
  radioBlackout: string;   // R0..R5
  radiationStorm: string;  // S0..S5
}

export interface VipSuggestion {
  email: string;
  count: number;        // number of replies in the lookback window
  lastReplyAt: string;  // ISO timestamp of the most recent reply
}

export interface CachedEmailClassification {
  id: string;
  accountEmail: string;
  priority: EmailPriority;
  summary: string;
  promptHash: string;
}

export interface ActionItem {
  emailId: string;
  from: string;
  subject: string;
  action: string;
  dueDate?: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  status: "needsAction" | "completed";
  due?: string;        // RFC 3339 timestamp ("2026-05-20T00:00:00.000Z")
  notes?: string;
  completed?: string;
  updated: string;
}

export interface NewsThread {
  label: string;
  headline: string;
  summary: string;
  trend: "rising" | "stable" | "fading";
  articleIds: string[];
  sources: string[];
  newsletterContext?: string;
}

export interface ThreadsResult {
  throughLine: string;
  threads: NewsThread[];
}
