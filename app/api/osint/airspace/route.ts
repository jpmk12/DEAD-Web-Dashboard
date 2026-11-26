import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFirNotams, getGpsNotams, getFuelNotams, type AirspaceResult } from "@/lib/airspace";
import { resolveFirs } from "@/lib/firData";
import { gpsAreas } from "@/lib/gpsNotams";
import { fetchDaipQuery } from "@/lib/notams";
import { parseAirspaceGroups } from "@/lib/airspace";

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
//   ?diag=fuel   → OWNER-ONLY: the FUEL_NOTAMS query run fresh (no cache) from
//                  production — status, bytes, the raw envelope's first 1,500
//                  chars, groups / rows parsed, the group codes and five rows
//                  verbatim — to pin the fuel row shape (the one capture was
//                  count 0). `&type=` probes another DAIP query type the same way.
// Fail-safe: { configured:false } when the DoD CA bundle isn't set, { live:false }
// on any fetch failure — the map must treat either as UNKNOWN, never "clear".
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ configured: true, live: false, type: "", groups: [] }, { status: 401 });
  }
  const sp = new URL(request.url).searchParams;
  const layer = sp.get("layer") ?? "fir";

  const diag = sp.get("diag");
  if (diag) {
    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!owner || session.user?.email?.toLowerCase() !== owner) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    const type = diag === "fuel" ? "FUEL_NOTAMS" : (sp.get("type") ?? "").toUpperCase();
    if (!/^[A-Z_]{3,30}$/.test(type)) return NextResponse.json({ error: "diag=fuel, or diag=type&type=<DAIP query type>" }, { status: 400 });
    const t0 = Date.now();
    const { configured, raw } = await fetchDaipQuery({ type, sort: "Criticality" });
    const groups = raw ? parseAirspaceGroups(raw, Date.now(), 400) : [];
    const rows = groups.flatMap((g) => g.notams.map((n) => ({ g: g.code, n })));
    let count: unknown = null;
    try { const j = raw ? JSON.parse(raw) : null; count = j && typeof j === "object" ? (j as Record<string, unknown>).count ?? (j as Record<string, unknown>).total ?? null : null; } catch { /* not JSON */ }
    return NextResponse.json({
      type, configured, live: raw != null, ms: Date.now() - t0, bytes: raw?.length ?? 0, count,
      groups: groups.length, rows: rows.length, codes: groups.slice(0, 40).map((g) => `${g.code} (${g.notams.length})`),
      sample: rows.slice(0, 5).map(({ g, n }) => `${g} | ${n.loc ?? "-"} | ${n.id ?? "-"} | ${(n.rawtext || n.text || "").replace(/\s+/g, " ").slice(0, 260)}`),
      rawFirst: raw ? raw.slice(0, 1500) : null,
    });
  }

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
