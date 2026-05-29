import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import { UserPrefs, AppTheme } from "@/lib/types";

const VALID_THEMES = new Set<AppTheme>(["nightwatch", "amber", "arctic", "mission"]);

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
