import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCountryDossier } from "@/lib/groundTruth";
import { getUserPrefs } from "@/lib/userPrefs";

export const dynamic = "force-dynamic";

// Per-country dossier (security incidents + local news) for the Ground Truth tab.
// Cached briefly per country so flipping between countries is snappy.
const TTL = 10 * 60 * 1000;
const cache = new Map<string, { body: unknown; expires: number }>();

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const country = (new URL(req.url).searchParams.get("country") || "").trim().slice(0, 60);
  if (!country) return NextResponse.json({ error: "country required" }, { status: 400 });

  const key = country.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return NextResponse.json(hit.body);

  try {
    const prefs = await getUserPrefs().catch(() => null);
    const dossier = await getCountryDossier(country, prefs?.osintFeeds ?? []);
    cache.set(key, { body: dossier, expires: Date.now() + TTL });
    return NextResponse.json(dossier);
  } catch {
    return NextResponse.json({ error: "dossier failed" }, { status: 502 });
  }
}
