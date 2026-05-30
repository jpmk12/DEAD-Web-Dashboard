import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { UserPrefs, TrackedLocation, TickerEntry, OsintFeed, AiFeature } from "./types";
import { ALL_AI_FEATURES } from "./aiFeatures";

const DEFAULT_MARKETS_WATCHLIST: TickerEntry[] = [
  { symbol: "NYSE:LMT",    label: "Lockheed Martin" },
  { symbol: "NYSE:RTX",    label: "RTX Corp" },
  { symbol: "NYSE:NOC",    label: "Northrop Grumman" },
  { symbol: "NYSE:GD",     label: "General Dynamics" },
  { symbol: "NYSE:BA",     label: "Boeing" },
];

const DEFAULT_PREFS: UserPrefs = {
  role: "",
  priorityTopics: [],
  deprioritizeTopics: [],
  watchlist: [],
  vipSenders: [],
  muteSenders: [],
  dismissedVipSuggestions: [],
  trackedLocations: [],
  marketsWatchlist: DEFAULT_MARKETS_WATCHLIST,
  osintFeeds: [],
  disabledNewsSources: [],
  aiEnabled: true,
  aiFeatureToggles: {},
  localFeedKey: "colorado",
  localZipcode: "",
  localCity: "",
  localLat: null,
  localLon: null,
  theme: "nightwatch",
  timezone: "America/Chicago",
  lastUpdated: new Date(0).toISOString(),
};

interface PrefsRow extends RowDataPacket {
  role: string | null;
  priority_topics: string[] | null;
  deprioritize_topics: string[] | null;
  watchlist: string[] | null;
  vip_senders: string[] | null;
  mute_senders: string[] | null;
  dismissed_vip_suggestions: string[] | null;
  tracked_locations: TrackedLocation[] | null;
  markets_watchlist: TickerEntry[] | null;
  osint_feeds: OsintFeed[] | null;
  disabled_news_sources: string[] | null;
  ai_enabled: number | null;
  ai_feature_toggles: Partial<Record<AiFeature, boolean>> | null;
  local_feed_key: string;
  local_zipcode: string;
  local_city: string;
  local_lat: number | null;
  local_lon: number | null;
  theme: string;
  timezone: string;
  last_updated: Date;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function asTrackedLocations(v: unknown): TrackedLocation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): TrackedLocation[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    if (typeof r.id !== "string" || typeof r.label !== "string") return [];
    return [{ id: r.id, label: r.label.slice(0, 60), lat, lon }];
  });
}

function asTickerEntries(v: unknown): TickerEntry[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): TickerEntry[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    if (typeof r.symbol !== "string" || typeof r.label !== "string") return [];
    return [{ symbol: r.symbol.slice(0, 32), label: r.label.slice(0, 60) }];
  });
}

function asAiFeatureToggles(v: unknown): Partial<Record<AiFeature, boolean>> {
  if (!v || typeof v !== "object") return {};
  const out: Partial<Record<AiFeature, boolean>> = {};
  const allowed = new Set(ALL_AI_FEATURES);
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (allowed.has(k as AiFeature) && typeof val === "boolean") {
      out[k as AiFeature] = val;
    }
  }
  return out;
}

function asOsintFeeds(v: unknown): OsintFeed[] {
  if (!Array.isArray(v)) return [];
  const KINDS = new Set(["social", "telegram", "news", "other"]);
  return v.flatMap((x): OsintFeed[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.label !== "string" || typeof r.url !== "string") return [];
    if (!/^https?:\/\//i.test(r.url)) return [];
    const kind = typeof r.kind === "string" && KINDS.has(r.kind) ? (r.kind as OsintFeed["kind"]) : "other";
    return [{ id: r.id, label: r.label.slice(0, 60), url: r.url.slice(0, 500), kind }];
  });
}

export async function getUserPrefs(): Promise<UserPrefs> {
  const pool = await getDb();
  const [rows] = await pool.query<PrefsRow[]>(
    "SELECT role, priority_topics, deprioritize_topics, watchlist, vip_senders, mute_senders, dismissed_vip_suggestions, tracked_locations, markets_watchlist, osint_feeds, disabled_news_sources, ai_enabled, ai_feature_toggles, local_feed_key, local_zipcode, local_city, local_lat, local_lon, theme, timezone, last_updated FROM user_prefs WHERE id = 1"
  );
  if (rows.length === 0) return { ...DEFAULT_PREFS };
  const r = rows[0];
  const validThemes = ["nightwatch", "amber", "arctic", "mission"] as const;
  return {
    role: r.role ?? "",
    priorityTopics: asStringArray(r.priority_topics),
    deprioritizeTopics: asStringArray(r.deprioritize_topics),
    watchlist: asStringArray(r.watchlist),
    vipSenders: asStringArray(r.vip_senders),
    muteSenders: asStringArray(r.mute_senders),
    dismissedVipSuggestions: asStringArray(r.dismissed_vip_suggestions),
    trackedLocations: asTrackedLocations(r.tracked_locations),
    // First-time users get the curated defense default until they edit.
    marketsWatchlist: r.markets_watchlist ? asTickerEntries(r.markets_watchlist) : DEFAULT_MARKETS_WATCHLIST,
    osintFeeds: asOsintFeeds(r.osint_feeds),
    disabledNewsSources: asStringArray(r.disabled_news_sources),
    // ai_enabled default is 1 in the schema; treat unset / null as enabled.
    aiEnabled: r.ai_enabled == null ? true : Boolean(r.ai_enabled),
    aiFeatureToggles: asAiFeatureToggles(r.ai_feature_toggles),
    localFeedKey: r.local_feed_key,
    localZipcode: r.local_zipcode,
    localCity: r.local_city,
    localLat: typeof r.local_lat === "number" ? r.local_lat : null,
    localLon: typeof r.local_lon === "number" ? r.local_lon : null,
    theme: (validThemes as readonly string[]).includes(r.theme)
      ? (r.theme as UserPrefs["theme"])
      : "nightwatch",
    timezone: r.timezone || "America/Chicago",
    lastUpdated: r.last_updated.toISOString(),
  };
}

export async function saveUserPrefs(prefs: Omit<UserPrefs, "lastUpdated">): Promise<void> {
  const pool = await getDb();
  const now = new Date();
  await pool.execute(
    `INSERT INTO user_prefs
       (id, role, priority_topics, deprioritize_topics, watchlist,
        vip_senders, mute_senders, dismissed_vip_suggestions,
        tracked_locations, markets_watchlist, osint_feeds, disabled_news_sources,
        ai_enabled, ai_feature_toggles,
        local_feed_key, local_zipcode, local_city, local_lat, local_lon,
        theme, timezone, last_updated)
     VALUES (1, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
             CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
             CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
             ?, CAST(? AS JSON),
             ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       role                       = VALUES(role),
       priority_topics            = VALUES(priority_topics),
       deprioritize_topics        = VALUES(deprioritize_topics),
       watchlist                  = VALUES(watchlist),
       vip_senders                = VALUES(vip_senders),
       mute_senders               = VALUES(mute_senders),
       dismissed_vip_suggestions  = VALUES(dismissed_vip_suggestions),
       tracked_locations          = VALUES(tracked_locations),
       markets_watchlist          = VALUES(markets_watchlist),
       osint_feeds                = VALUES(osint_feeds),
       disabled_news_sources      = VALUES(disabled_news_sources),
       ai_enabled                 = VALUES(ai_enabled),
       ai_feature_toggles         = VALUES(ai_feature_toggles),
       local_feed_key             = VALUES(local_feed_key),
       local_zipcode              = VALUES(local_zipcode),
       local_city                 = VALUES(local_city),
       local_lat                  = VALUES(local_lat),
       local_lon                  = VALUES(local_lon),
       theme                      = VALUES(theme),
       timezone                   = VALUES(timezone),
       last_updated               = VALUES(last_updated)`,
    [
      prefs.role,
      JSON.stringify(prefs.priorityTopics),
      JSON.stringify(prefs.deprioritizeTopics),
      JSON.stringify(prefs.watchlist),
      JSON.stringify(prefs.vipSenders),
      JSON.stringify(prefs.muteSenders),
      JSON.stringify(prefs.dismissedVipSuggestions),
      JSON.stringify(prefs.trackedLocations),
      JSON.stringify(prefs.marketsWatchlist),
      JSON.stringify(prefs.osintFeeds),
      JSON.stringify(prefs.disabledNewsSources ?? []),
      prefs.aiEnabled ? 1 : 0,
      JSON.stringify(prefs.aiFeatureToggles ?? {}),
      prefs.localFeedKey,
      prefs.localZipcode,
      prefs.localCity,
      prefs.localLat,
      prefs.localLon,
      prefs.theme,
      prefs.timezone,
      now,
    ]
  );
}

// ─── Sender-rule matching (VIP / mute lists) ─────────────────────────────────
// A rule is either a full email (`john@example.com`) or a bare domain
// (`example.com`). Domain rules match the domain and any subdomain.

function extractSenderEmail(from: string): { email: string; domain: string } | null {
  const m = from.match(/<([^>]+)>/);
  const raw = (m ? m[1] : from).trim().toLowerCase();
  if (!raw.includes("@")) return null;
  const at = raw.lastIndexOf("@");
  return { email: raw, domain: raw.slice(at + 1) };
}

export function senderMatches(from: string, rules: string[]): boolean {
  if (!rules.length) return false;
  const s = extractSenderEmail(from);
  if (!s) return false;
  for (const raw of rules) {
    const norm = raw.trim().toLowerCase().replace(/^@/, "");
    if (!norm) continue;
    if (norm.includes("@")) {
      if (s.email === norm) return true;
      continue;
    }
    // Bare domain rule
    if (s.domain === norm) return true;
    if (s.domain.endsWith("." + norm)) return true;
  }
  return false;
}

function q(s: string): string {
  return `"${s.replace(/[\x00-\x1f"\\]/g, " ").trim()}"`;
}

export function buildUserContext(prefs: UserPrefs): string {
  const parts: string[] = [];
  if (prefs.role) parts.push(`User role/context: ${q(prefs.role)}`);
  if (prefs.priorityTopics.length)
    parts.push(`Priority topics (emphasise): ${prefs.priorityTopics.map(q).join(", ")}`);
  if (prefs.deprioritizeTopics.length)
    parts.push(`Deprioritise topics: ${prefs.deprioritizeTopics.map(q).join(", ")}`);
  if (prefs.watchlist.length)
    parts.push(`Watchlist terms (flag when mentioned): ${prefs.watchlist.map(q).join(", ")}`);
  return parts.length ? "\n\nUser preferences:\n" + parts.join("\n") : "";
}
