import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import { UserPrefs, AppTheme, TrackedLocation, TickerEntry, OsintFeed, AiFeature } from "@/lib/types";
import { ALL_AI_FEATURES } from "@/lib/aiFeatures";

const VALID_THEMES = new Set<AppTheme>(["nightwatch", "amber", "arctic", "mission"]);
const OSINT_KINDS = new Set<OsintFeed["kind"]>(["social", "telegram", "news", "other"]);

function sanitizeTrackedLocations(v: unknown): TrackedLocation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): TrackedLocation[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const label = String(r.label ?? "").trim().slice(0, 60);
    if (!label) return [];
    const id = String(r.id ?? "").slice(0, 60) || `${lat.toFixed(2)},${lon.toFixed(2)}`;
    return [{ id, label, lat, lon }];
  }).slice(0, 10);
}

function sanitizeMarketsWatchlist(v: unknown): TickerEntry[] {
  if (!Array.isArray(v)) return [];
  // Symbol whitelist: alnum + a few exchange-separator chars only. TradingView
  // accepts shapes like "NYSE:LMT" / "NASDAQ:NDX" / "NYMEX:CL1!" / "FX:USDJPY".
  const SYMBOL = /^[A-Z0-9:_!.\-]{1,32}$/;
  return v.flatMap((x): TickerEntry[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const symbol = String(r.symbol ?? "").trim().toUpperCase();
    const label = String(r.label ?? "").trim().slice(0, 60);
    if (!symbol || !SYMBOL.test(symbol) || !label) return [];
    return [{ symbol, label }];
  }).slice(0, 30);
}

// Block obvious SSRF targets when the OSINT feeds are later fetched
// server-side. Public IP ranges + arbitrary HTTPS URLs are allowed; loopback,
// link-local, and RFC-1918 private space are not.
function isSafeHostname(h: string): boolean {
  if (!h) return false;
  if (h === "localhost" || h === "broadcasthost" || h === "ip6-localhost") return false;
  if (/^127\./.test(h)) return false;
  if (/^10\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^(::1|fe80:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i.test(h)) return false;
  if (/^0\.0\.0\.0$/.test(h)) return false;
  return true;
}

function sanitizeAiFeatureToggles(v: unknown): Partial<Record<AiFeature, boolean>> {
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

function sanitizeOsintFeeds(v: unknown): OsintFeed[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): OsintFeed[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const urlRaw = String(r.url ?? "").trim();
    const label = String(r.label ?? "").trim().slice(0, 60);
    if (!urlRaw || !label) return [];
    let parsed: URL;
    try { parsed = new URL(urlRaw); } catch { return []; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (parsed.username || parsed.password) return [];
    if (!isSafeHostname(parsed.hostname.toLowerCase())) return [];
    const id = String(r.id ?? "").slice(0, 60) || Buffer.from(urlRaw).toString("base64").slice(0, 16);
    const kind = OSINT_KINDS.has(r.kind as OsintFeed["kind"]) ? (r.kind as OsintFeed["kind"]) : "other";
    return [{ id, label, url: urlRaw.slice(0, 500), kind }];
  }).slice(0, 20);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await getUserPrefs();
  return NextResponse.json({ prefs });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 60_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const raw = body as Partial<UserPrefs>;
  const VALID_FEED_KEYS = new Set(["colorado", "dc", "hampton_roads", "san_antonio", "hawaii", "japan", "germany", "illinois", "oklahoma", "new_jersey"]);
  const rawLat = Number(raw.localLat);
  const rawLon = Number(raw.localLon);
  const prefs: Omit<UserPrefs, "lastUpdated"> = {
    role: String(raw.role ?? "").slice(0, 500),
    priorityTopics: (Array.isArray(raw.priorityTopics) ? raw.priorityTopics : [])
      .slice(0, 20).map((t) => String(t).slice(0, 100)),
    deprioritizeTopics: (Array.isArray(raw.deprioritizeTopics) ? raw.deprioritizeTopics : [])
      .slice(0, 20).map((t) => String(t).slice(0, 100)),
    watchlist: (Array.isArray(raw.watchlist) ? raw.watchlist : [])
      .slice(0, 50).map((t) => String(t).slice(0, 100)),
    vipSenders: (Array.isArray(raw.vipSenders) ? raw.vipSenders : [])
      .slice(0, 100).map((t) => String(t).trim().slice(0, 254))
      .filter((t) => t.length > 0),
    muteSenders: (Array.isArray(raw.muteSenders) ? raw.muteSenders : [])
      .slice(0, 100).map((t) => String(t).trim().slice(0, 254))
      .filter((t) => t.length > 0),
    dismissedVipSuggestions: (Array.isArray(raw.dismissedVipSuggestions) ? raw.dismissedVipSuggestions : [])
      .slice(0, 500).map((t) => String(t).trim().slice(0, 254))
      .filter((t) => t.length > 0),
    trackedLocations: sanitizeTrackedLocations(raw.trackedLocations),
    marketsWatchlist: sanitizeMarketsWatchlist(raw.marketsWatchlist),
    osintFeeds: sanitizeOsintFeeds(raw.osintFeeds),
    aiEnabled: typeof raw.aiEnabled === "boolean" ? raw.aiEnabled : true,
    aiFeatureToggles: sanitizeAiFeatureToggles(raw.aiFeatureToggles),
    localFeedKey: VALID_FEED_KEYS.has(String(raw.localFeedKey ?? "")) ? String(raw.localFeedKey) : "colorado",
    localZipcode: String(raw.localZipcode ?? "").replace(/[^0-9a-zA-Z]/g, "").slice(0, 10),
    localCity: String(raw.localCity ?? "").slice(0, 100),
    localLat: isFinite(rawLat) && rawLat !== 0 ? rawLat : null,
    localLon: isFinite(rawLon) && rawLon !== 0 ? rawLon : null,
    theme: VALID_THEMES.has(raw.theme as AppTheme) ? (raw.theme as AppTheme) : "nightwatch",
    timezone: typeof raw.timezone === "string" && /^[A-Za-z_/]+$/.test(raw.timezone) ? raw.timezone.slice(0, 50) : "America/Chicago",
  };

  await saveUserPrefs(prefs);
  return NextResponse.json({ ok: true });
}
