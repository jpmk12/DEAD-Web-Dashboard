import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFlightCategories, type AviationWx } from "@/lib/aviationWx";

export const dynamic = "force-dynamic";

// Live flight category (VFR/MVFR/IFR/LIFR) + limiting fields for the Crisis-map
// node markers (CRF / hubs / gateway airfields). Batched METAR via the NWS
// Aviation Weather Center (keyless), chunked to getFlightCategories' 12-ICAO cap.
// `live:false` when AWC is unreachable so the map degrades to UNKNOWN (no ring),
// never a false "VFR/clear".
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ byIcao: {}, live: false }, { status: 401 });

  const ids = Array.from(new Set(
    (new URL(request.url).searchParams.get("icao") ?? "")
      .split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{4}$/.test(s)),
  )).slice(0, 80);
  if (!ids.length) return NextResponse.json({ byIcao: {}, live: true });

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 12) chunks.push(ids.slice(i, i + 12));
  const results = await Promise.all(chunks.map((c) => getFlightCategories(c).catch(() => ({ live: false, byIcao: {} as Record<string, AviationWx> }))));

  const byIcao: Record<string, AviationWx> = {};
  let live = false;
  for (const r of results) { Object.assign(byIcao, r.byIcao); if (r.live) live = true; }
  return NextResponse.json({ byIcao, live }, { headers: { "Cache-Control": "private, max-age=300" } });
}
