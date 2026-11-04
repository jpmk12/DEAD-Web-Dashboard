import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFirNotams, getGpsNotams, getFuelNotams, type AirspaceResult } from "@/lib/airspace";
import { resolveFirs } from "@/lib/firData";
import { gpsAreas } from "@/lib/gpsNotams";

export const dynamic = "force-dynamic";

// DAIP airspace / system NOTAMs for the Crisis map (keyless, DoD DAIP):
//   ?layer=fir   (default) → enroute/overflight NOTAMs by FIR. Pass the FIRs as
//                  ?countries=Syria,Iraq,Iran and/or ?fir=OSTT,ORBB — both are
//                  resolved to FIR codes (lib/firData). Groups carry centroids.
//   ?layer=gps   → official GPS/WAAS outage NOTAMs (complements GPSJam).
//   ?layer=fuel  → fuel availability NOTAMs.
//   ?layer=gpsareas → the GPS_WAAS list reduced to DRAWABLE areas (FAA test
//                  disks with every ring, published polygons) — the Crisis
//                  map's "GPS tests" layer. Same cached DAIP query as ?layer=gps.
// Fail-safe: { configured:false } when the DoD CA bundle isn't set, { live:false }
// on any fetch failure — the map must treat either as UNKNOWN, never "clear".
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ configured: true, live: false, type: "", groups: [] }, { status: 401 });
  }
  const sp = new URL(request.url).searchParams;
  const layer = sp.get("layer") ?? "fir";

  if (layer === "gpsareas") {
    const r = await getGpsNotams().catch(() => null);
    const now = Date.now();
    const notams = r ? r.groups.flatMap((g) => g.notams) : [];
    return NextResponse.json({
      configured: r?.configured ?? true,
      live: r?.live ?? false,
      areas: gpsAreas(notams, now),
      asOf: new Date(now).toISOString(),
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  }

  let result: AirspaceResult;
  if (layer === "gps") {
    result = await getGpsNotams().catch(() => null) ?? { configured: true, live: false, type: "GPS_WAAS", groups: [] };
  } else if (layer === "fuel") {
    result = await getFuelNotams().catch(() => null) ?? { configured: true, live: false, type: "FUEL_NOTAMS", groups: [] };
  } else {
    const tokens = [
      ...(sp.get("countries") ?? "").split(","),
      ...(sp.get("fir") ?? "").split(","),
    ].map((s) => s.trim()).filter(Boolean);
    const codes = resolveFirs(tokens).map((f) => f.code);
    result = await getFirNotams(codes).catch(() => null) ?? { configured: true, live: false, type: "FIR_ARTCC", groups: [] };
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=300" } });
}
