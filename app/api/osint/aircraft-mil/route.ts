import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Global military aircraft for the Crisis map's "Mil air" layer. Source: the
// keyless community tar1090 mirrors' /v2/mil endpoint (airplanes.live, adsb.lol),
// which returns EVERY military aircraft currently broadcasting ADS-B worldwide in
// one call — ideal for a global view (OpenSky's bbox feed used by the OSINT
// aircraft pane is local-only). ADS-B Exchange proper now needs a paid RapidAPI
// key, so we default to the keyless mirrors.
//
// HONEST SA: this is "what's broadcasting" — coverage follows the volunteer
// receiver network (strong over US/Europe/Middle East, sparse mid-ocean) and
// many military aircraft fly with ADS-B off or spoofed. Not ground truth.

interface MilAircraft {
  hex: string; flight: string; type: string; reg: string;
  lat: number; lon: number; altFt: number | null; onGround: boolean;
  gs: number | null; track: number | null; squawk: string; desc: string;
}

// Keyless /v2/mil mirrors, tried in order.
const SOURCES = [
  { name: "airplanes.live", url: "https://api.airplanes.live/v2/mil" },
  { name: "adsb.lol", url: "https://api.adsb.lol/v2/mil" },
];

const TTL = 30_000; // be polite to the volunteer mirrors
let cache: { aircraft: MilAircraft[]; source: string; fetchedAt: number } | null = null;

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function normalize(raw: unknown): MilAircraft[] {
  const list: unknown[] = Array.isArray((raw as { ac?: unknown[] })?.ac) ? (raw as { ac: unknown[] }).ac : [];
  const out: MilAircraft[] = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const lat = numOrNull(r.lat), lon = numOrNull(r.lon);
    if (lat == null || lon == null) continue;
    const altRaw = r.alt_baro;
    out.push({
      hex: String(r.hex ?? "").trim(),
      flight: String(r.flight ?? "").trim(),
      type: String(r.t ?? "").trim(),
      reg: String(r.r ?? "").trim(),
      lat, lon,
      altFt: typeof altRaw === "number" ? altRaw : null,
      onGround: altRaw === "ground",
      gs: numOrNull(r.gs),
      track: numOrNull(r.track),
      squawk: String(r.squawk ?? "").trim(),
      desc: String(r.desc ?? "").trim(),
    });
  }
  return out.slice(0, 1200);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, aircraft: [] }, { status: 401 });
  if (cache && Date.now() - cache.fetchedAt < TTL) {
    return NextResponse.json({ ok: true, aircraft: cache.aircraft, source: cache.source, fetchedAt: cache.fetchedAt, cached: true });
  }

  for (const src of SOURCES) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(src.url, { signal: ctrl.signal, headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)", Accept: "application/json" }, cache: "no-store" });
      clearTimeout(tid);
      if (!res.ok) continue;
      const aircraft = normalize(await res.json());
      if (aircraft.length === 0) continue; // try the next mirror
      cache = { aircraft, source: src.name, fetchedAt: Date.now() };
      return NextResponse.json({ ok: true, aircraft, source: src.name, fetchedAt: cache.fetchedAt });
    } catch {
      clearTimeout(tid);
      // try next mirror
    }
  }
  // All mirrors failed — serve last-good if we have it, else honest empty/ok:false.
  if (cache) return NextResponse.json({ ok: true, aircraft: cache.aircraft, source: cache.source, fetchedAt: cache.fetchedAt, stale: true });
  return NextResponse.json({ ok: false, aircraft: [] });
}
