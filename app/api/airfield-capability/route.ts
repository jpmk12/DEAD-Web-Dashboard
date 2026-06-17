import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { airfieldCapabilities } from "@/lib/ourAirports";

export const dynamic = "force-dynamic";

// Runway capability (longest open runway + surface → C-17/C-130/light class) for
// one or more ICAO idents, from OurAirports' runways.csv (keyless, cached 24h).
// Advisory only — planning-grade, not navigation. Used by the Crisis map gateway
// popups and the Ground Truth access section.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ caps: {} }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("icao") || "";
  const idents = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 200);
  if (idents.length === 0) return NextResponse.json({ caps: {} });

  try {
    const caps = await airfieldCapabilities(idents);
    return NextResponse.json({ caps });
  } catch {
    return NextResponse.json({ caps: {} }, { status: 502 });
  }
}
