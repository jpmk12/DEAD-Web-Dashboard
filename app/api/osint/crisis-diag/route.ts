import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { diagnoseAcled } from "@/lib/acled";
import { diagnoseUcdp } from "@/lib/conflictEvents";
import { diagnoseOurAirports } from "@/lib/ourAirports";
import { diagnoseInform } from "@/lib/inform";

export const dynamic = "force-dynamic";

// Live, in-app diagnostic for the three Crisis-map data sources, so "source
// down" / "no ACLED data" becomes a concrete status the owner can read and
// report. Run on demand from the ACLED settings card — does real fetches, so
// it's never part of the normal page load.

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function probe(url: string, headers: Record<string, string>, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, cache: "no-store", signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - t0, bytes: text.length, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, bytes: 0, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(tid);
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";

  // UCDP — the keyless conflict source that replaced GDELT's retired GEO API.
  // Probes the candidate-version list and reports which responds + a sample, so
  // the version can be pinned (the monthly candidate scheme isn't confirmable
  // from the build sandbox).
  const ucdpP = diagnoseUcdp();

  // GPSJam — daily H3 file; today may not be published yet, so the app falls
  // back to yesterday. Report both.
  const gpsjamP = (async () => {
    const today = ymd(new Date());
    const yest = ymd(new Date(Date.now() - 86_400_000));
    const [t, y] = await Promise.all([
      probe(`https://gpsjam.org/data/${today}-h3_4.csv`, { "User-Agent": UA, Accept: "text/csv,*/*" }, 15_000),
      probe(`https://gpsjam.org/data/${yest}-h3_4.csv`, { "User-Agent": UA, Accept: "text/csv,*/*" }, 15_000),
    ]);
    const ok = t.status === 200 ? t : y.status === 200 ? y : null;
    const okDay = t.status === 200 ? today : y.status === 200 ? yest : null;
    // First CSV line = the header, so we can confirm the column names live.
    const header = ok?.text ? ok.text.split(/\r?\n/)[0]?.slice(0, 120) : undefined;
    return {
      today: { status: t.status, bytes: t.bytes }, yesterday: { status: y.status, bytes: y.bytes },
      header,
      note: okDay ? `Reachable (using ${okDay}; header: ${header ?? "?"}).`
        : "Neither today's nor yesterday's GPSJam CSV was reachable — upstream/outage or the daily file isn't published yet.",
    };
  })();

  const [ucdp, gpsjam, acled, ourairports, inform] = await Promise.all([
    ucdpP, gpsjamP, diagnoseAcled(),
    diagnoseOurAirports().catch((e) => ({ count: 0, note: "probe threw: " + (e instanceof Error ? e.message : String(e)) })),
    diagnoseInform().catch((e) => [{ product: "risk" as const, note: "probe threw: " + (e instanceof Error ? e.message : String(e)) }]),
  ]);
  return NextResponse.json({ acled, ucdp, gpsjam, ourairports, inform, at: Date.now() });
}
