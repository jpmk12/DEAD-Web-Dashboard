import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";

export const dynamic = "force-dynamic";

// Owner-only probe for the SITREP v2 infrastructure sources. The build
// sandbox can't reach these hosts, so (per the house capture-then-build
// pattern) this route runs the candidate requests FROM PROD and returns
// status + a response sample, letting us pin the real contracts before
// writing parsers. Probes are sized to the first configured base.
//
//   GET /api/sitrep/infra-diag        (owner only)
//
// Candidates:
//   IODA  — internet outage signals (Georgia Tech), keyless
//   USGS  — water services instantaneous values (flood gauges), keyless
//   FAA   — NAS status airport events (delay programs), keyless XML
//   GDELT — power-outage news query shape (already-used host, query check)

async function probe(name: string, url: string, accept = "application/json"): Promise<{
  name: string; url: string; status: number | string; contentType?: string; sample?: string;
}> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      headers: { "User-Agent": "DEAD-Dashboard/1.0", Accept: accept },
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    return {
      name,
      url,
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      sample: text.slice(0, 600),
    };
  } catch (err) {
    return { name, url, status: err instanceof Error ? err.message : "fetch failed" };
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || session.user?.email?.toLowerCase() !== owner) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const prefs = await getUserPrefs();
  const base = prefs.sitrepBases[0] ?? { icao: "KWRI", label: "JB MDL", lat: 40.0155, lon: -74.5917 };
  const bbox = `${(base.lon - 0.5).toFixed(2)},${(base.lat - 0.4).toFixed(2)},${(base.lon + 0.5).toFixed(2)},${(base.lat + 0.4).toFixed(2)}`;

  const results = await Promise.all([
    probe("ioda-entities", "https://api.ioda.inetintel.cc.gatech.edu/v2/entities/query?entityType=region&search=new%20jersey"),
    probe("ioda-signals", "https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/region/4437?from=now-1d&until=now"),
    probe("usgs-gauges", `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00065&siteStatus=active`),
    probe("faa-nas-status", "https://nasstatus.faa.gov/api/airport-status-information", "application/xml,text/xml,*/*"),
    probe("gdelt-power-query", `https://api.gdeltproject.org/api/v2/doc/doc?query=%22power%20outage%22%20${encodeURIComponent(`"${base.label.split(" ")[0]}"`)}&mode=artlist&format=json&maxrecords=5&timespan=3d`),
  ]);

  return NextResponse.json({
    base: { icao: base.icao, label: base.label },
    probedAt: new Date().toISOString(),
    note: "Paste this output back into a session to pin parsers for SITREP v2 infra sources.",
    results,
  });
}
