import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleSitrep } from "@/lib/sitrep";

export const dynamic = "force-dynamic";

// GET /api/sitrep?icao=KWRI — the assembled situation report for one
// configured base. Restricted to bases in prefs.sitrepBases (the config is
// the contract; arbitrary ICAOs would let the endpoint fan out to DAIP/GDELT
// for any field).
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const icao = (url.searchParams.get("icao") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) return NextResponse.json({ error: "icao required" }, { status: 400 });

  const prefs = await getUserPrefs();
  const base = prefs.sitrepBases.find((b) => b.icao === icao);
  if (!base) return NextResponse.json({ error: "Base not configured" }, { status: 404 });

  try {
    const payload = await assembleSitrep(base);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("sitrep assembly failed:", err);
    return NextResponse.json({ error: "SITREP assembly failed" }, { status: 500 });
  }
}
