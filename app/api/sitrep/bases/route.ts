import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import { ALL_AIRFIELDS } from "@/lib/airfields";
import { AMC_HUBS } from "@/lib/amcHubs";
import { airportByIdent } from "@/lib/ourAirports";
import type { SitrepBase } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_BASES = 4;

// Resolve an ICAO to a SitrepBase: curated sets first (AMC hubs, gateways —
// they carry good display names), then the OurAirports global CSV.
async function resolveIcao(icaoRaw: string): Promise<SitrepBase | null> {
  const icao = icaoRaw.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) return null;

  for (const region of AMC_HUBS) {
    const hub = region.hubs.find((h) => h.icao === icao);
    if (hub) {
      const country = /^K|^P[AHG]/.test(icao) ? "United States" : "";
      return { icao, label: hub.name, lat: hub.lat, lon: hub.lon, country, place: hub.name };
    }
  }
  const gw = ALL_AIRFIELDS.find((a) => a.icao === icao);
  if (gw) {
    return { icao, label: gw.name, lat: gw.lat, lon: gw.lon, country: gw.country ?? "", place: gw.name };
  }
  const oa = await airportByIdent(icao).catch(() => null);
  if (oa) {
    // OurAirports carries an ISO2 country code; "US" is the one worth
    // expanding (State-advisory matching), the rest pass through as-is.
    const country = oa.country === "US" ? "United States" : oa.country;
    return { icao, label: oa.name.slice(0, 80), lat: oa.lat, lon: oa.lon, country, place: oa.name.slice(0, 120) };
  }
  return null;
}

// GET → the configured SITREP bases.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getUserPrefs();
  return NextResponse.json({ bases: prefs.sitrepBases });
}

// POST { op: "add", icao } | { op: "remove", icao } — server-side merge into
// prefs so the SITREP pane never round-trips the whole preferences object.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { op?: unknown; icao?: unknown; artcc?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const op = body.op;
  const icao = String(body.icao ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) return NextResponse.json({ error: "Valid 4-char ICAO required" }, { status: 400 });

  const prefs = await getUserPrefs();
  let bases = prefs.sitrepBases;

  const artccRaw = String(body.artcc ?? "").trim().toUpperCase();
  const artcc = /^[A-Z]{3,4}$/.test(artccRaw) ? artccRaw : undefined;

  if (op === "add") {
    if (bases.some((b) => b.icao === icao)) return NextResponse.json({ bases });
    if (bases.length >= MAX_BASES) return NextResponse.json({ error: `Max ${MAX_BASES} bases` }, { status: 400 });
    const resolved = await resolveIcao(icao);
    if (!resolved) return NextResponse.json({ error: `${icao} not found in hubs, gateways, or OurAirports` }, { status: 404 });
    bases = [...bases, { ...resolved, ...(artcc ? { artcc } : {}) }];
  } else if (op === "remove") {
    bases = bases.filter((b) => b.icao !== icao);
  } else if (op === "artcc") {
    // Set (or clear, when body.artcc is empty) the owning center on a base.
    if (!bases.some((b) => b.icao === icao)) return NextResponse.json({ error: "Base not configured" }, { status: 404 });
    bases = bases.map((b) => b.icao === icao ? { ...b, ...(artcc ? { artcc } : { artcc: undefined }) } : b);
  } else {
    return NextResponse.json({ error: "op must be add|remove|artcc" }, { status: 400 });
  }

  await saveUserPrefs({ ...prefs, sitrepBases: bases });
  return NextResponse.json({ bases });
}
