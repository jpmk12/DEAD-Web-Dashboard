// Recent armed-conflict / kinetic-event density via GDELT's GEO 2.0 API (open,
// no key). Shared by the Crisis map's "Conflict" layer (/api/osint/conflict)
// and the AI crisis read so both read from one cache and one query.
//
// The query spans the kinetic spectrum an analyst watches for: air/missile/drone
// strikes, shelling/rocket fire, air-defense engagements and shootdowns (downed
// aircraft), naval/tanker attacks, and the recovery/rescue follow-on
// (search-and-rescue / personnel recovery). Coarse OSINT, not a curated product.

export interface ConflictPoint { lat: number; lon: number; name: string; count: number; title?: string; url?: string }

const TTL = 30 * 60 * 1000;
let cache: { points: ConflictPoint[]; expires: number } | null = null;

const QUERY =
  '("air strike" OR airstrike OR "missile strike" OR "drone strike" OR ' +
  '"rocket attack" OR shelling OR "armed clashes" OR "shot down" OR ' +
  '"downed aircraft" OR "air defense" OR "ballistic missile" OR ' +
  '"cruise missile" OR "naval strike" OR "tanker attack" OR ' +
  '"search and rescue" OR "personnel recovery")';

const GDELT_URL =
  "https://api.gdeltproject.org/api/v2/geo/geo?query=" +
  encodeURIComponent(QUERY) +
  "&format=GeoJSON&timespan=2d";

// GDELT GEO GeoJSON puts a small HTML blob of the top articles for each location
// in properties.html. Pull the first article's headline + URL so each point can
// show a readable event, not just a density count. Best-effort: if the shape
// changes or there's no link, callers fall back to the location name.
function firstArticle(html: string): { title?: string; url?: string } {
  if (!html) return {};
  const m = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (!m) return {};
  const url = m[1].trim();
  const title = m[2]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    url: /^https?:\/\//i.test(url) ? url : undefined,
    title: title ? title.slice(0, 140) : undefined,
  };
}

export async function getConflictPoints(): Promise<ConflictPoint[]> {
  if (cache && cache.expires > Date.now()) return cache.points;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(GDELT_URL, { signal: ctrl.signal, headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" }, cache: "no-store" });
    clearTimeout(tid);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const feats = Array.isArray((data as { features?: unknown[] })?.features) ? (data as { features: unknown[] }).features : [];
    const points: ConflictPoint[] = [];
    for (const f of feats) {
      const geom = (f as { geometry?: { coordinates?: unknown[] } })?.geometry;
      const props = (f as { properties?: Record<string, unknown> })?.properties ?? {};
      const lon = Number(geom?.coordinates?.[0]);
      const lat = Number(geom?.coordinates?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const { title, url } = firstArticle(typeof props.html === "string" ? props.html : "");
      points.push({ lat, lon, name: String(props.name ?? "").slice(0, 120), count: Number(props.count ?? 1) || 1, title, url });
    }
    points.sort((a, b) => b.count - a.count);
    const top = points.slice(0, 250);
    cache = { points: top, expires: Date.now() + TTL };
    return top;
  } catch {
    return [];
  }
}
