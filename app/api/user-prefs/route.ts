import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs, saveUserPrefs, savePersonalPrefs, sanitizeSitrepBases, APP_THEMES } from "@/lib/userPrefs";
import { clearBriefingCache, clearBriefingCacheFor } from "@/lib/briefingCache";
import { UserPrefs, AppTheme, TrackedLocation, ForceLocation, CountryWatch, TickerEntry, OsintFeed, NewsletterSourceRule, MetarStation, AiFeature } from "@/lib/types";
import { ALL_AI_FEATURES } from "@/lib/aiFeatures";
import { classifyAor } from "@/lib/aor";
import { isOwner } from "@/lib/currentUser";
import { normEmail } from "@/lib/allowlist";
import { sanitizeOsintFeeds } from "@/lib/osintFeeds";

const VALID_THEMES = new Set<AppTheme>(APP_THEMES);
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

  const prefs = await getUserPrefs(normEmail(session.user?.email));
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
    forceLocations: sanitizeForceLocations(raw.forceLocations),
    countriesOfInterest: sanitizeCountriesOfInterest(raw.countriesOfInterest),
    marketsWatchlist: sanitizeMarketsWatchlist(raw.marketsWatchlist),
    // Absent = preserve stored (same contract as sitrepBases): the Sources
    // pane edits this field through its own targeted endpoint, so a drawer
    // save with a stale in-memory copy must not silently revert those edits.
    // The drawer only includes osintFeeds when its editor was actually used.
    osintFeeds: Array.isArray(raw.osintFeeds)
      ? sanitizeOsintFeeds(raw.osintFeeds)
      : (await getUserPrefs().catch(() => null))?.osintFeeds ?? [],
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

  // Multi-user phase 2 split: the OWNER writes the shared row (team config +
  // his personal values, single-user-era layout). CREW writes touch ONLY the
  // personal subset, into their user_personal_prefs overlay — team fields in
  // their payload are ignored, so a crew Save can never clobber team config.
  const email = normEmail(session.user?.email);
  if (isOwner(email)) {
    await saveUserPrefs(prefs);
    // Team config feeds every brief — a team edit invalidates all of them.
    clearBriefingCache().catch((err) => console.error("Briefing cache invalidation failed:", err));
  } else {
    // Save from the RAW body, not the fully-defaulted `prefs` object above:
    // sanitizeOverlay's contract is "absent key = fall through to base", and
    // the defaulted object would pin every personal default into the overlay
    // on first save (freezing the user out of future default improvements).
    await savePersonalPrefs(email, raw);
    // A personal edit only invalidates the caller's brief.
    clearBriefingCacheFor(email).catch((err) => console.error("Briefing cache invalidation failed:", err));
  }
  return NextResponse.json({ ok: true });
}
