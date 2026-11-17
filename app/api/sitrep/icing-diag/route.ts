import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { diagnoseFieldWx } from "@/lib/fieldWx";

export const dynamic = "force-dynamic";

// Owner-only: runs the icing read's two new sources FROM PRODUCTION (the build
// sandbox reaches neither) — the Open-Meteo pressure-level profile and the AWC
// PIREP list — and returns status, bytes, parsed counts and the first raw
// PIREP row, so the contracts can be pinned from one paste.
//   GET /api/sitrep/icing-diag            → the first SITREP base
//   GET /api/sitrep/icing-diag?icao=OJAQ  → that base (must be a SITREP base)

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || session.user?.email?.toLowerCase() !== owner) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const want = new URL(req.url).searchParams.get("icao")?.trim().toUpperCase();
  const prefs = await getUserPrefs();
  const base = (want ? prefs.sitrepBases.find((b) => b.icao === want) : prefs.sitrepBases[0]) ?? null;
  if (!base) return NextResponse.json({ error: want ? `${want} is not a SITREP base` : "No SITREP base configured" }, { status: 404 });
  return NextResponse.json(await diagnoseFieldWx(base.icao, base.lat, base.lon));
}
