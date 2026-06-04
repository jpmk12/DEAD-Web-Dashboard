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
  source: string;  // newsletter source rule id — see NewsletterSourceRule (defaults: politico/dow/merge/asf)
  account: "primary" | "secondary";
  accountEmail: string;
}

// A user-configurable rule for which emails count as "newsletters". Each rule
// matches by sender OR subject; the route turns it into a Gmail query
// (`from:<value>` or `subject:"<value>"`). `id` is the value stored on each
// summary's `source` field and used to look up the display badge.
export interface NewsletterSourceRule {
  id: string;
  label: string;                    // badge text, e.g. "POLITICO"
  matchType: "sender" | "subject";
  value: string;                    // sender email/domain, or subject phrase
  color?: string;                   // badge palette key (blue/emerald/violet/amber/sky/rose/teal/orange)
  enabled?: boolean;                // default true; false skips the rule without deleting it
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
  // Newsletters — configurable rules for which emails are pulled in as
  // newsletters, matched by sender or subject. Empty/unset → the four built-in
  // defaults (Politico / Dept of War / The Merge / A&SF).
  newsletterSources: NewsletterSourceRule[];
  // Weather — airfields shown with decoded METAR/TAF. Unset → the built-in
  // default set of military fields.
  metarStations: MetarStation[];
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
  | "news_thesis"    // /api/news/thesis (per-article thesis button)
  | "quick_capture"  // /api/quick-capture
  | "markets_brief"  // /api/markets/brief
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

// A user-chosen airfield for decoded METAR/TAF on the Weather tab.
export interface MetarStation {
  icao: string;   // 4-char ICAO, e.g. "KCOS"
  label: string;  // display name, e.g. "Peterson SFB (CO)"
}

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN";

export interface MetarObs {
  icao: string;
  name: string;            // station name from the data source
  observedAt: string;      // ISO timestamp of the observation
  raw: string;             // raw METAR
  flightCategory: FlightCategory;
  windDir: number | null;  // degrees; null = calm or variable
  windVariable: boolean;
  windSpeedKt: number | null;
  windGustKt: number | null;
  visibilityMi: number | null;
  ceilingFt: number | null;  // lowest broken/overcast layer; null = none reported
  tempC: number | null;
  dewpointC: number | null;
  altimeterInHg: number | null;
  pressureTendency: number | null; // 3-hr pressure change (sign = rising/falling)
  weather: string;           // decoded present-weather phrase ("light rain, mist")
  clouds: { cover: string; baseFt: number | null }[];
  summary: string;           // plain-English one-liner
}

export interface TafPeriod {
  from: string;              // ISO
  to: string;                // ISO
  changeType: string;        // "" | "BECMG" | "TEMPO" | "FM" | "PROB30" ...
  flightCategory: FlightCategory;
  summary: string;           // plain-English line for this period
}

export interface TafReport {
  icao: string;
  issuedAt: string;          // ISO
  raw: string;
  periods: TafPeriod[];
}

export interface StationWx {
  icao: string;
  metar: MetarObs | null;
  taf: TafReport | null;
  error?: string;            // set when the station couldn't be fetched/decoded
}

// A severe-weather alert aggregated across the user's tracked locations.
export interface SevereThreat {
  id: string;
  event: string;                       // "Tornado Warning"
  severity: WeatherAlert["severity"];
  tier: "warning" | "watch" | "advisory" | "statement" | "other";
  lifeThreatening: boolean;            // tornado/hurricane/severe-tstorm/flash-flood warnings, etc.
  headline: string;
  areaDesc: string;
  effective: string;
  expires: string;
  locations: string[];                 // tracked-location labels this alert covers
}

// An active tropical cyclone from the National Hurricane Center.
export interface TropicalSystem {
  id: string;
  name: string;
  classification: string;              // raw code: HU / TS / TD / STS / TY ...
  category: string;                    // human label
  intensityKt: number | null;
  pressureMb: number | null;
  lat: number | null;
  lon: number | null;
  movement: string;
  lastUpdate: string;
  link: string;                        // NHC storm page ("learn more")
}

// A humanitarian / natural-disaster event (GDACS, USGS, ReliefWeb, tsunami
// warning centers, volcanic-ash sources).
export interface DisasterEvent {
  id: string;
  type: "earthquake" | "cyclone" | "flood" | "volcano" | "drought" | "tsunami" | "epidemic" | "wildfire" | "other";
  title: string;
  severity: "red" | "orange" | "green" | "unknown";
  country: string;
  aor: import("./aor").Aor;    // U.S. combatant-command AOR (UCP-aligned, coarse)
  lat: number | null;
  lon: number | null;
  time: string;                // ISO
  magnitude: number | null;    // earthquake magnitude when applicable
  tsunami: boolean;
  summary: string;
  source: "GDACS" | "USGS" | "ReliefWeb" | "NTWC" | "PTWC" | "USGS-VHP";
  link: string;
  nearLocations: string[];     // tracked-location labels within ~500 km
}

// Model-derived (Open-Meteo) aviation/ops hazard read at a tracked point. Fills
// the OCONUS gap where NWS warnings don't reach. Guidance, not an official warning.
export interface LocationHazard {
  label: string;
  lat: number;
  lon: number;
  severity: "severe" | "elevated";
  flags: string[]; // e.g. ["Gusts 41 kt 14–18Z", "IFR vis 06–09Z", "Thunderstorms 20–22Z"]
}
export interface WeatherThreats {
  threats: SevereThreat[];
  tropical: TropicalSystem[];
  disasters: DisasterEvent[];
  hazards: LocationHazard[];
  summary: { extreme: number; severe: number; lifeThreatening: number; total: number; topEvent: string | null; disasters: number; disastersRed: number; hazardLocations: number };
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
