import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveAirfield } from "@/lib/resolveAirfield";

export const dynamic = "force-dynamic";

// ICAO → labeled airfield (curated hubs/gateways → OurAirports). Used by the
// Mission Profile hub/spoke editor so the profile stores RESOLVED points and
// the derivation stays pure client-side.
//   GET ?icao=KWRI → { icao, label, lat, lon, country, place } | 404
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const icao = new URL(req.url).searchParams.get("icao") ?? "";
  const field = await resolveAirfield(icao).catch(() => null);
  if (!field) return NextResponse.json({ error: `Couldn't resolve "${icao.trim().toUpperCase()}" — check the ICAO.` }, { status: 404 });
  return NextResponse.json(field);
}
