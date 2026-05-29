import type { RowDataPacket } from "mysql2";
import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { getDb } from "./db";
import { VipSuggestion } from "./types";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const LOOKBACK_QUERY = "in:sent newer_than:30d";
const SCAN_MAX = 200;        // max sent messages to fetch metadata for
const SUGGESTION_MIN_COUNT = 3;
const SUGGESTION_LIMIT = 5;

interface CacheRow extends RowDataPacket {
  suggestions: VipSuggestion[];
  computed_at: string | number;
}

interface CachedResult {
  suggestions: VipSuggestion[];
  computedAt: number;
}

function buildClient(accessToken: string) {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  return gmailApi({ version: "v1", auth: oauth2Client });
}

function parseToHeader(raw: string): string[] {
  // "Foo <foo@bar.com>, baz@qux.com" → ["foo@bar.com", "baz@qux.com"]
  return raw
    .split(",")
    .map((part) => {
      const m = part.match(/<([^>]+)>/);
      return (m ? m[1] : part).trim().toLowerCase();
    })
    .filter((email) => /[^@\s]+@[^@\s]+/.test(email));
}

async function readCache(accountEmail: string): Promise<CachedResult | null> {
  const pool = await getDb();
  const [rows] = await pool.query<CacheRow[]>(
    "SELECT suggestions, computed_at FROM vip_suggestions_cache WHERE account_email = ?",
    [accountEmail]
  );
  if (rows.length === 0) return null;
  return {
    suggestions: Array.isArray(rows[0].suggestions) ? rows[0].suggestions : [],
    computedAt: Number(rows[0].computed_at) || 0,
  };
}

async function writeCache(accountEmail: string, suggestions: VipSuggestion[]): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO vip_suggestions_cache (account_email, suggestions, computed_at)
     VALUES (?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       suggestions  = VALUES(suggestions),
       computed_at  = VALUES(computed_at)`,
    [accountEmail, JSON.stringify(suggestions), Date.now()]
  );
}

async function scanSentMetadata(accessToken: string): Promise<VipSuggestion[]> {
  const gmail = buildClient(accessToken);
  const list = await gmail.users.messages.list({
    userId: "me",
    q: LOOKBACK_QUERY,
    maxResults: SCAN_MAX,
  });
  const ids = (list.data.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  // Pull just the To + Date headers per message. Bounded concurrency keeps the
  // Gmail API happy on bursts.
  const metaResults = await Promise.all(
    ids.map((id) =>
      gmail.users.messages
        .get({ userId: "me", id, format: "metadata", metadataHeaders: ["To", "Date"] })
        .then((r) => r.data)
        .catch(() => null)
    )
  );

  const counts = new Map<string, { count: number; lastReplyAt: number }>();
  for (const msg of metaResults) {
    if (!msg?.payload?.headers) continue;
    const to = msg.payload.headers.find((h) => h.name?.toLowerCase() === "to")?.value ?? "";
    const dateStr = msg.payload.headers.find((h) => h.name?.toLowerCase() === "date")?.value ?? "";
    const at = dateStr ? new Date(dateStr).getTime() : 0;
    for (const recipient of parseToHeader(to)) {
      const cur = counts.get(recipient) ?? { count: 0, lastReplyAt: 0 };
      cur.count += 1;
      cur.lastReplyAt = Math.max(cur.lastReplyAt, at || 0);
      counts.set(recipient, cur);
    }
  }

  return [...counts.entries()]
    .filter(([, v]) => v.count >= SUGGESTION_MIN_COUNT)
    .map(([email, v]) => ({
      email,
      count: v.count,
      lastReplyAt: v.lastReplyAt ? new Date(v.lastReplyAt).toISOString() : "",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, SUGGESTION_LIMIT);
}

// Returns suggestions for the given account, filtered against excludeList
// (which should be the union of vipSenders + muteSenders + dismissed list).
// Hits cache if computed within TTL.
export async function getVipSuggestions(
  accessToken: string,
  accountEmail: string,
  excludeList: Set<string>
): Promise<VipSuggestion[]> {
  if (!accountEmail) return [];
  const exclude = (s: VipSuggestion) => {
    const domain = s.email.split("@")[1] ?? "";
    return excludeList.has(s.email.toLowerCase()) || excludeList.has("@" + domain);
  };

  const cached = await readCache(accountEmail).catch(() => null);
  if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) {
    return cached.suggestions.filter((s) => !exclude(s));
  }

  let fresh: VipSuggestion[];
  try {
    fresh = await scanSentMetadata(accessToken);
  } catch (err) {
    console.error("VIP suggestion scan failed:", err);
    // Fall back to last cached even if stale
    return cached?.suggestions.filter((s) => !exclude(s)) ?? [];
  }
  writeCache(accountEmail, fresh).catch((err) =>
    console.error("VIP suggestion cache write failed:", err)
  );
  return fresh.filter((s) => !exclude(s));
}
