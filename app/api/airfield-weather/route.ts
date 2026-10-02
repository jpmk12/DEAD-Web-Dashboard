import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFlightCategories, type AviationWx } from "@/lib/aviationWx";
import { getSensorSeriesMany } from "@/lib/sensorStore";
import { sensorKey } from "@/lib/sensorKeys";
import { liftRead, type LiftRead } from "@/lib/sitrep";

export const dynamic = "force-dynamic";

// Live flight category (VFR/MVFR/IFR/LIFR) + limiting fields for the Crisis-map
// node markers (CRF / hubs / gateway airfields). Batched METAR via the NWS
// Aviation Weather Center (keyless), chunked to getFlightCategories' 12-ICAO cap.
// `live:false` when AWC is unreachable so the map degrades to UNKNOWN (no ring),
// never a false "VFR/clear".
//
// `lift` rides the same call: today's mobility lift at each field against its
// own recorded normal (the mob:<icao> series the I&W mobility sensor writes for
// hubs on a board — PLAN §5 C2). Only fields with a series appear; one query.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ byIcao: {}, live: false }, { status: 401 });

  const ids = Array.from(new Set(
    (new URL(request.url).searchParams.get("icao") ?? "")
      .split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{4}$/.test(s)),
  )).slice(0, 80);
  if (!ids.length) return NextResponse.json({ byIcao: {}, live: true, lift: {} });

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 12) chunks.push(ids.slice(i, i + 12));
  const [results, liftSeries] = await Promise.all([
    Promise.all(chunks.map((c) => getFlightCategories(c).catch(() => ({ live: false, byIcao: {} as Record<string, AviationWx> })))),
    getSensorSeriesMany(ids.map((i) => sensorKey("mob", i)), 90).catch(() => ({} as Record<string, { day: string; value: number }[]>)),
  ]);

  const byIcao: Record<string, AviationWx> = {};
  let live = false;
  for (const r of results) { Object.assign(byIcao, r.byIcao); if (r.live) live = true; }

  const today = new Date().toISOString().slice(0, 10);
  const lift: Record<string, LiftRead> = {};
  for (const icao of ids) {
    const series = liftSeries[sensorKey("mob", icao)];
    if (!series?.length) continue;
    const r = liftRead(series, today);
    if (r) lift[icao] = r;
  }
  return NextResponse.json({ byIcao, live, lift }, { headers: { "Cache-Control": "private, max-age=300" } });
}
