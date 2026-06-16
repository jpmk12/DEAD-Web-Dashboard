import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { UserPrefs, TrackedLocation, ForceLocation, TickerEntry, OsintFeed, NewsletterSourceRule, MetarStation, AiFeature } from "./types";
import { ALL_AI_FEATURES } from "./aiFeatures";
import { classifyAor } from "./aor";
import { encryptSecret, decryptSecret } from "./secretBox";

const DEFAULT_MARKETS_WATCHLIST: TickerEntry[] = [
  { symbol: "NYSE:LMT",    label: "Lockheed Martin" },
  { symbol: "NYSE:RTX",    label: "RTX Corp" },
  { symbol: "NYSE:NOC",    label: "Northrop Grumman" },
  { symbol: "NYSE:GD",     label: "General Dynamics" },
  { symbol: "NYSE:BA",     label: "Boeing" },
];

// The original hardcoded newsletter sources, now seeded as editable defaults.
// `id`s intentionally match the legacy `source` literals so existing
// newsletter_cache rows and badge colours carry over with no data migration.
// Returned whenever a user has never customised the list (column NULL).
export const DEFAULT_NEWSLETTER_SOURCES: NewsletterSourceRule[] = [
  { id: "politico", label: "POLITICO",    matchType: "sender", value: "politico.com",                        color: "blue",    enabled: true },
  { id: "dow",      label: "DEPT OF WAR", matchType: "sender", value: "govdelivery@subscriptions.war.gov",    color: "emerald", enabled: true },
  { id: "merge",    label: "THE MERGE",   matchType: "sender", value: "news@themerge.co",                     color: "violet",  enabled: true },
  { id: "asf",      label: "A&SF",        matchType: "sender", value: "AirAndSpaceForcesMagazine@afa.org",    color: "amber",   enabled: true },
];

// Originally hardcoded in WeatherTab; seeded as editable defaults so the same
// airfields appear with decoded METAR/TAF and existing users lose nothing.
export const DEFAULT_METAR_STATIONS: MetarStation[] = [
  { icao: "KCOS", label: "Peterson/CSAF (CO)" },
  { icao: "KADW", label: "Andrews AFB (MD)" },
  { icao: "KNGU", label: "Norfolk NAS (VA)" },
  { icao: "KFAF", label: "Langley AFB (VA)" },
  { icao: "KLCH", label: "Barksdale AFB (LA)" },
  { icao: "KDYS", label: "Dyess AFB (TX)" },
  { icao: "PHIK", label: "Hickam AFB (HI)" },
  { icao: "RODN", label: "Kadena AB (JPN)" },
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
  forceLocations: [],
  marketsWatchlist: DEFAULT_MARKETS_WATCHLIST,
  osintFeeds: [],
  newsletterSources: DEFAULT_NEWSLETTER_SOURCES,
  metarStations: DEFAULT_METAR_STATIONS,
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
  force_locations: ForceLocation[] | null;
  markets_watchlist: TickerEntry[] | null;
  osint_feeds: OsintFeed[] | null;
  newsletter_sources: NewsletterSourceRule[] | null;
  metar_stations: MetarStation[] | null;
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function asForceLocations(v: unknown): ForceLocation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): ForceLocation[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    if (typeof r.id !== "string" || typeof r.label !== "string") return [];
    const country = typeof r.country === "string" ? r.country.trim().slice(0, 60) : "";
    const icaoRaw = typeof r.icao === "string" ? r.icao.trim().toUpperCase() : "";
    const icao = /^[A-Z0-9]{4}$/.test(icaoRaw) ? icaoRaw : undefined;
    const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 80) : undefined;
    const start = typeof r.start === "string" && YMD.test(r.start) ? r.start : undefined;
    const end = typeof r.end === "string" && YMD.test(r.end) ? r.end : undefined;
    // cocom is always re-derived server-side (coords win) so a stale/forged
    // client value can never mislabel a base's combatant command.
    const cocom = classifyAor({ lat, lon, name: country });
    return [{
      id: r.id, label: r.label.slice(0, 60), ...(icao ? { icao } : {}), lat, lon,
      country, cocom, ...(note ? { note } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}),
    }];
  }).slice(0, 30);
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

function asNewsletterSources(v: unknown): NewsletterSourceRule[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): NewsletterSourceRule[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.label !== "string" || typeof r.value !== "string") return [];
    const value = r.value.trim();
    if (!value) return [];
    const matchType = r.matchType === "subject" ? "subject" : "sender";
    const color = typeof r.color === "string" ? r.color.slice(0, 24) : undefined;
    const enabled = r.enabled === false ? false : true;
    return [{ id: r.id.slice(0, 64), label: r.label.slice(0, 40), matchType, value: value.slice(0, 200), color, enabled }];
  }).slice(0, 12);
}

function asMetarStations(v: unknown): MetarStation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): MetarStation[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const icao = String(r.icao ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(icao)) return [];
    const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 60) : icao;
    return [{ icao, label }];
  }).slice(0, 12);
}

export async function getUserPrefs(): Promise<UserPrefs> {
  const pool = await getDb();
  const [rows] = await pool.query<PrefsRow[]>(
    "SELECT role, priority_topics, deprioritize_topics, watchlist, vip_senders, mute_senders, dismissed_vip_suggestions, tracked_locations, force_locations, markets_watchlist, osint_feeds, newsletter_sources, metar_stations, disabled_news_sources, ai_enabled, ai_feature_toggles, local_feed_key, local_zipcode, local_city, local_lat, local_lon, theme, timezone, last_updated FROM user_prefs WHERE id = 1"
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
    forceLocations: asForceLocations(r.force_locations),
    // First-time users get the curated defense default until they edit.
    marketsWatchlist: r.markets_watchlist ? asTickerEntries(r.markets_watchlist) : DEFAULT_MARKETS_WATCHLIST,
    osintFeeds: asOsintFeeds(r.osint_feeds),
    // NULL column = user never customised → seed the legacy hardcoded sources.
    // A saved-but-empty array ([]) is respected (user removed them all).
    newsletterSources: r.newsletter_sources == null
      ? DEFAULT_NEWSLETTER_SOURCES
      : asNewsletterSources(r.newsletter_sources),
    metarStations: r.metar_stations == null
      ? DEFAULT_METAR_STATIONS
      : asMetarStations(r.metar_stations),
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
        tracked_locations, force_locations, markets_watchlist, osint_feeds, newsletter_sources, metar_stations, disabled_news_sources,
        ai_enabled, ai_feature_toggles,
        local_feed_key, local_zipcode, local_city, local_lat, local_lon,
        theme, timezone, last_updated)
     VALUES (1, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
             CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
             CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
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
       force_locations            = VALUES(force_locations),
       markets_watchlist          = VALUES(markets_watchlist),
       osint_feeds                = VALUES(osint_feeds),
       newsletter_sources         = VALUES(newsletter_sources),
       metar_stations             = VALUES(metar_stations),
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
      JSON.stringify(prefs.forceLocations ?? []),
      JSON.stringify(prefs.marketsWatchlist),
      JSON.stringify(prefs.osintFeeds),
      JSON.stringify(prefs.newsletterSources ?? []),
      JSON.stringify(prefs.metarStations ?? []),
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

// ─── ACLED credentials (server-only secret) ──────────────────────────────────
// Stored in dedicated user_prefs columns rather than the JSON prefs blob, and
// deliberately NOT part of UserPrefs / getUserPrefs — so the password can never
// ride along in the /api/user-prefs GET that the browser receives. The main
// prefs upsert (saveUserPrefs) doesn't touch these columns either, so saving
// prefs never clobbers the credentials. Only the dedicated /api/settings/acled
// endpoint and lib/acled read/write them. The password is encrypted at rest
// (lib/secretBox, AES-256-GCM keyed off NEXTAUTH_SECRET) — never stored plaintext.

export interface AcledCredentials { email: string; password: string }

export async function getAcledCredentials(): Promise<AcledCredentials | null> {
  const pool = await getDb();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT acled_email, acled_password FROM user_prefs WHERE id = 1"
  );
  if (rows.length === 0) return null;
  const email = String(rows[0].acled_email ?? "").trim();
  const stored = String(rows[0].acled_password ?? "");
  if (!email || !stored) return null;
  // Stored encrypted (legacy plaintext is returned as-is by decryptSecret). An
  // empty result means an undecryptable blob (e.g. NEXTAUTH_SECRET rotated) —
  // treat as unconfigured rather than authenticating with garbage.
  const password = await decryptSecret(stored);
  if (!password) return null;
  return { email, password };
}

// The email alone is safe to surface to the client (so the settings form can
// show which account is configured); the password is never returned.
export async function getAcledEmail(): Promise<string> {
  const pool = await getDb();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT acled_email FROM user_prefs WHERE id = 1"
  );
  return rows.length ? String(rows[0].acled_email ?? "").trim() : "";
}

export async function saveAcledCredentials(email: string, password: string): Promise<void> {
  const pool = await getDb();
  const encrypted = await encryptSecret(password); // never store the password in plaintext
  // Upsert only the two columns. If the row exists (the common case) this is an
  // UPDATE of just these fields and leaves the rest of the prefs untouched; if
  // not, it seeds the row with column defaults for everything else.
  await pool.execute(
    `INSERT INTO user_prefs (id, acled_email, acled_password, last_updated)
       VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE acled_email = VALUES(acled_email), acled_password = VALUES(acled_password)`,
    [email, encrypted, new Date()]
  );
}

export async function clearAcledCredentials(): Promise<void> {
  const pool = await getDb();
  await pool.execute("UPDATE user_prefs SET acled_email = NULL, acled_password = NULL WHERE id = 1");
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
