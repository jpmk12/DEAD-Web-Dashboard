import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { UserPrefs } from "./types";

const DEFAULT_PREFS: UserPrefs = {
  role: "",
  priorityTopics: [],
  deprioritizeTopics: [],
  watchlist: [],
  vipSenders: [],
  muteSenders: [],
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

export async function getUserPrefs(): Promise<UserPrefs> {
  const pool = await getDb();
  const [rows] = await pool.query<PrefsRow[]>(
    "SELECT role, priority_topics, deprioritize_topics, watchlist, vip_senders, mute_senders, local_feed_key, local_zipcode, local_city, local_lat, local_lon, theme, timezone, last_updated FROM user_prefs WHERE id = 1"
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
        vip_senders, mute_senders,
        local_feed_key, local_zipcode, local_city, local_lat, local_lon,
        theme, timezone, last_updated)
     VALUES (1, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
             CAST(? AS JSON), CAST(? AS JSON),
             ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       role                = VALUES(role),
       priority_topics     = VALUES(priority_topics),
       deprioritize_topics = VALUES(deprioritize_topics),
       watchlist           = VALUES(watchlist),
       vip_senders         = VALUES(vip_senders),
       mute_senders        = VALUES(mute_senders),
       local_feed_key      = VALUES(local_feed_key),
       local_zipcode       = VALUES(local_zipcode),
       local_city          = VALUES(local_city),
       local_lat           = VALUES(local_lat),
       local_lon           = VALUES(local_lon),
       theme               = VALUES(theme),
       timezone            = VALUES(timezone),
       last_updated        = VALUES(last_updated)`,
    [
      prefs.role,
      JSON.stringify(prefs.priorityTopics),
      JSON.stringify(prefs.deprioritizeTopics),
      JSON.stringify(prefs.watchlist),
      JSON.stringify(prefs.vipSenders),
      JSON.stringify(prefs.muteSenders),
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
