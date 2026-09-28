import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

// Why this route exists: a user report of "the map isn't displaying and says
// API key required" could not be reproduced or even located from a development
// sandbox, because the sandbox's egress policy blocks every host the map talks
// to (tile CDNs, ADS-B mirrors, RainViewer) — the same wall that made DAIP and
// travel.state.gov unverifiable from here. The message was not in our code, so
// it had to be coming back from one of those upstreams, and the only machine
// that can see which one is the deployed host.
//
// So: one owner-only probe that hits every host the Crisis map depends on
// FROM PRODUCTION and reports the real HTTP status plus the first 200
// characters of the body. A blank layer stops being a mystery and starts being
// a line of output naming the service and what it said.
//
// Same discipline as /api/osint/crisis-diag and the energy panel's ?debug=1:
// real fetches, never on a page load, owner-gated because the bodies can
// contain upstream detail.

const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";
// Tile CDNs and some community mirrors reject non-browser agents outright, and
// that 403 is itself a finding worth distinguishing from a key demand — so
// probe tiles the way the browser does.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

interface Probe {
  /** What breaks in the UI when this one fails. */
  layer: string;
  host: string;
  status: number;
  ms: number;
  bytes: number;
  contentType?: string;
  /** First 200 chars, tags stripped — where an "API key required" body shows up. */
  body?: string;
  error?: string;
}

async function probe(
  layer: string,
  url: string,
  opts: { ua?: string; timeoutMs?: number; expectBinary?: boolean } = {},
): Promise<Probe> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": opts.ua ?? UA, Accept: "*/*" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? undefined;
    // A successful tile is binary; decoding it would be noise. A FAILING tile is
    // almost always text, and that text is the whole point of this route.
    const isImage = !!contentType && contentType.startsWith("image/");
    const body = res.ok && (isImage || opts.expectBinary)
      ? undefined
      : Buffer.from(buf).toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    return { layer, host, status: res.status, ms: Date.now() - t0, bytes: buf.byteLength, contentType, body };
  } catch (e) {
    return { layer, host, status: 0, ms: Date.now() - t0, bytes: 0, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(tid);
  }
}

export async function GET() {
  const session = await auth();
  if (!isOwner(session?.user?.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const probes = await Promise.all([
    // The basemap — the ONE failure that means "there is no map" rather than
    // "one layer has no data". Probed in provider-chain order.
    probe("basemap (primary)", "https://a.basemaps.cartocdn.com/dark_all/3/4/3.png", { ua: BROWSER_UA }),
    probe("basemap (fallback 1)", "https://tile.openstreetmap.org/3/4/3.png", { ua: BROWSER_UA }),
    probe("basemap (fallback 2)", "https://a.tile.opentopomap.org/3/4/3.png", { ua: BROWSER_UA }),
    // Mil air — community ADS-B mirrors. These are the likeliest source of a
    // literal "API key required": free REST tiers here have been withdrawn
    // before, and the route tries them in this order.
    probe("Mil air (airplanes.live)", "https://api.airplanes.live/v2/mil"),
    probe("Mil air (adsb.lol)", "https://api.adsb.lol/v2/mil"),
    // Radar index (the tiles themselves are loaded direct by the browser).
    probe("Radar index", "https://api.rainviewer.com/public/weather-maps.json"),
    probe("Radar tiles", "https://tilecache.rainviewer.com/v2/coverage/0/256/3/4/3/0/0.png", { ua: BROWSER_UA }),
    // Conflict layer, both legs of its fallback.
    probe("Conflict (UCDP)", "https://ucdpapi.pcr.uu.se/api/gedevents/26.1?pagesize=1&page=0"),
    probe("Conflict (ReliefWeb fallback)", "https://api.reliefweb.int/v1/disasters?appname=dead-web-dashboard&limit=1"),
    // Node rings / capability / risk.
    probe("Flight categories (AWC)", "https://aviationweather.gov/api/data/metar?ids=KWRI&format=json"),
    probe("Airfields (OurAirports)", "https://davidmegginson.github.io/ourairports-data/airports.csv", { expectBinary: true }),
    probe("INFORM Risk", "https://data360api.worldbank.org/data360/data?DATABASE_ID=DRMKC_INFORM&INDICATOR=INFORM_OVRL&skip=0&top=1"),
    probe("GPS interference (GPSJam)", "https://gpsjam.org/data/2026-09-27-h3_4.json"),
  ]);

  // Env keys the map's optional layers read. Presence only — never the value.
  const env = {
    UCDP_API_TOKEN: !!process.env.UCDP_API_TOKEN?.trim(),
    AISSTREAM_API_KEY: !!process.env.AISSTREAM_API_KEY?.trim(),
    ACLED_EMAIL: !!process.env.ACLED_EMAIL?.trim(),
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY?.trim(),
  };

  const keyDemands = probes.filter(
    (p) => /api[ _-]?(key|token)|unauthori[sz]ed|requires? (an )?(api )?(key|token)|subscription/i.test(p.body ?? ""),
  );
  const basemapOk = probes.some((p) => p.layer.startsWith("basemap") && p.status === 200);

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    // The headline: if no basemap serves a tile, the map really is blank, and
    // that is a different bug from any single layer being empty.
    basemapOk,
    keyDemands: keyDemands.map((p) => ({ layer: p.layer, host: p.host, status: p.status, body: p.body })),
    env,
    probes,
    note: basemapOk
      ? "At least one basemap provider is serving tiles, so a blank map is NOT a tile problem — look at the failing probes below and at the browser console for a render error."
      : "NO basemap provider served a tile from this host. That alone produces an empty map, whatever the data layers say.",
  });
}
