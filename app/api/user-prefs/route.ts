import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs, saveUserPrefs, sanitizeSitrepBases } from "@/lib/userPrefs";
import { clearBriefingCache } from "@/lib/briefingCache";
import { UserPrefs, AppTheme, TrackedLocation, ForceLocation, CountryWatch, TickerEntry, OsintFeed, NewsletterSourceRule, MetarStation, AiFeature } from "@/lib/types";
import { ALL_AI_FEATURES } from "@/lib/aiFeatures";
import { classifyAor } from "@/lib/aor";
import { isOwner } from "@/lib/currentUser";

const VALID_THEMES = new Set<AppTheme>(["nightwatch", "amber", "arctic", "mission"]);
const OSINT_KINDS = new Set<OsintFeed["kind"]>(["social", "telegram", "news", "other"]);
const NL_BADGE_COLORS = new Set(["blue", "emerald", "violet", "amber", "sky", "rose", "teal", "orange"]);

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

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeForceLocations(v: unknown): ForceLocation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): ForceLocation[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const label = String(r.label ?? "").trim().slice(0, 60);
    if (!label) return [];
    const id = String(r.id ?? "").slice(0, 60) || `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const country = String(r.country ?? "").trim().slice(0, 60);
    const icaoRaw = String(r.icao ?? "").trim().toUpperCase();
    const icao = /^[A-Z0-9]{4}$/.test(icaoRaw) ? icaoRaw : undefined;
    const note = String(r.note ?? "").trim().slice(0, 80) || undefined;
    const start = typeof r.start === "string" && YMD_RE.test(r.start) ? r.start : undefined;
    const end = typeof r.end === "string" && YMD_RE.test(r.end) ? r.end : undefined;
    // Always re-derive the combatant command (coords win) so the stored value
    // is authoritative regardless of what the client sent.
    const cocom = classifyAor({ lat, lon, name: country });
    const kind = (x as Record<string, unknown>).kind === "country" ? "country" : "base";
    return [{ id, label, ...(icao ? { icao } : {}), lat, lon, country, cocom, kind,
      ...(note ? { note } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) }];
  }).slice(0, 30);
}

function sanitizeCountriesOfInterest(v: unknown): CountryWatch[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): CountryWatch[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const country = String(r.country ?? "").trim().slice(0, 60);
    if (!country) return [];
    const id = String(r.id ?? "").slice(0, 60) || country.toLowerCase().replace(/\s+/g, "-");
    const note = String(r.note ?? "").trim().slice(0, 80) || undefined;
    const cocom = classifyAor({ name: country }); // authoritative, re-derived
    return [{ id, country, cocom, ...(note ? { note } : {}) }];
  }).slice(0, 40);
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

function sanitizeNewsletterSources(v: unknown): NewsletterSourceRule[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.flatMap((x): NewsletterSourceRule[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const label = String(r.label ?? "").trim().slice(0, 40);
    // Strip newlines/quotes so a value can't break the Gmail query syntax.
    const value = String(r.value ?? "").trim().replace(/[\r\n"]+/g, " ").slice(0, 200);
    if (!label || !value) return [];
    const matchType: NewsletterSourceRule["matchType"] = r.matchType === "subject" ? "subject" : "sender";
    let id = String(r.id ?? "").trim().slice(0, 64);
    if (!id || seen.has(id)) id = `nl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    seen.add(id);
    const color = typeof r.color === "string" && NL_BADGE_COLORS.has(r.color) ? r.color : undefined;
    const enabled = r.enabled !== false;
    return [{ id, label, matchType, value, ...(color ? { color } : {}), enabled }];
  }).slice(0, 12);
}

function sanitizeMetarStations(v: unknown): MetarStation[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.flatMap((x): MetarStation[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const icao = String(r.icao ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(icao) || seen.has(icao)) return [];
    seen.add(icao);
    const label = String(r.label ?? "").trim().slice(0, 60) || icao;
    return [{ icao, label }];
  }).slice(0, 12);
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
  // Multi-user phase 1: user_prefs is still ONE shared row (team config +
  // the owner's personal prefs), so writes are owner-only until the phase-2
  // personal/team split lands. Crew members get read access (GET) so every
  // tab renders, and their personal surfaces (email, calendar, brief, chat
  // memory, UI state) are already per-user.
  if (!isOwner(session.user?.email)) {
    return NextResponse.json(
      { error: "Preferences are managed by the dashboard owner for now — personal settings for crew accounts arrive in the next update." },
      { status: 403 }
    );
  }

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
    forceLocations: sanitizeForceLocations(raw.forceLocations),
    countriesOfInterest: sanitizeCountriesOfInterest(raw.countriesOfInterest),
    marketsWatchlist: sanitizeMarketsWatchlist(raw.marketsWatchlist),
    osintFeeds: sanitizeOsintFeeds(raw.osintFeeds),
    newsletterSources: sanitizeNewsletterSources(raw.newsletterSources),
    metarStations: sanitizeMetarStations(raw.metarStations),
    // Bounded list of source names. Cap at 100 to prevent unbounded growth
    // if the catalog ever balloons. Names trimmed and bounded to 80 chars.
    disabledNewsSources: (Array.isArray(raw.disabledNewsSources) ? raw.disabledNewsSources : [])
      .slice(0, 100)
      .map((t: unknown) => String(t).trim().slice(0, 80))
      .filter((t: string) => t.length > 0),
    aiEnabled: typeof raw.aiEnabled === "boolean" ? raw.aiEnabled : true,
    aiFeatureToggles: sanitizeAiFeatureToggles(raw.aiFeatureToggles),
    localFeedKey: VALID_FEED_KEYS.has(String(raw.localFeedKey ?? "")) ? String(raw.localFeedKey) : "colorado",
    localZipcode: String(raw.localZipcode ?? "").replace(/[^0-9a-zA-Z]/g, "").slice(0, 10),
    localCity: String(raw.localCity ?? "").slice(0, 100),
    // Coords of 0,0 are valid (Gulf of Guinea). Track presence with the raw
    // body field — null/undefined = unset, anything else = use the parsed number.
    localLat: raw.localLat != null && isFinite(rawLat) ? rawLat : null,
    localLon: raw.localLon != null && isFinite(rawLon) ? rawLon : null,
    theme: VALID_THEMES.has(raw.theme as AppTheme) ? (raw.theme as AppTheme) : "nightwatch",
    timezone: typeof raw.timezone === "string" && /^[A-Za-z_/]+$/.test(raw.timezone) ? raw.timezone.slice(0, 50) : "America/Chicago",
    timezoneMode: raw.timezoneMode === "pinned" ? "pinned" : "auto",
    // SITREP bases are managed by /api/sitrep/bases, not the Preferences form.
    // A prefs Save that doesn't carry them must PRESERVE the stored value —
    // otherwise every Preferences save would wipe the SITREP config.
    sitrepBases: Array.isArray(raw.sitrepBases)
      ? sanitizeSitrepBases(raw.sitrepBases)
      : (await getUserPrefs().catch(() => null))?.sitrepBases ?? [],
  };

  await saveUserPrefs(prefs);
  // The Morning Brief is cached per date+tz and reads home/role/topics/tz from
  // prefs — drop that cache so an edit (e.g. changing home) is reflected today
  // instead of being masked by this morning's already-generated brief.
  clearBriefingCache().catch((err) => console.error("Briefing cache invalidation failed:", err));
  return NextResponse.json({ ok: true });
}
