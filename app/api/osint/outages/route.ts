import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getIodaOutageAlerts } from "@/lib/cyberSources";
import { countryCentroid } from "@/lib/countryCentroids";

export const dynamic = "force-dynamic";

// Crisis-map "Outages" layer (REVIEW-CYBER-SPACE §4.4): IODA country-level
// connectivity outage alerts (24 h) plotted at country centroid — worst
// level per country, source count. `live:false` = feed unreachable, which
// the map's source-down strip must show as UNKNOWN, never a calm world.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const io = await getIodaOutageAlerts(24);
  const rank = (l: string) => (l === "critical" ? 2 : l === "warning" ? 1 : 0);
  const by = new Map<string, { country: string; level: string; sources: Set<string>; latest: number }>();
  for (const a of io.alerts) {
    if (a.entityType !== "country" || rank(a.level) === 0) continue;
    const cur = by.get(a.entityName);
    if (!cur) by.set(a.entityName, { country: a.entityName, level: a.level, sources: new Set([a.datasource]), latest: a.time });
    else { if (rank(a.level) > rank(cur.level)) cur.level = a.level; cur.sources.add(a.datasource); cur.latest = Math.max(cur.latest, a.time); }
  }
  const points = [...by.values()].map((v) => {
    // IODA names carry UN-style parentheticals ("Iran (Islamic Republic of)").
    const cen = countryCentroid(v.country) ?? countryCentroid(v.country.replace(/\s*\(.*\)$/, ""));
    return cen ? { country: v.country, level: v.level, sources: v.sources.size, latest: v.latest, lat: cen[0], lon: cen[1] } : null;
  }).filter((p): p is NonNullable<typeof p> => !!p);
  return NextResponse.json({ live: io.live, points });
}
