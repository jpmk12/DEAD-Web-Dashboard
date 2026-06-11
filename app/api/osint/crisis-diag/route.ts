import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { diagnoseAcled } from "@/lib/acled";

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

// First ~160 chars of an error body, whitespace-collapsed — enough to read an
// upstream's own 404/403 explanation without dumping a page.
function bodySnippet(text?: string): string | undefined {
  if (!text) return undefined;
  const s = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 160) : undefined;
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";

  // GDELT GEO — the keyless conflict-density source.
  const gdeltUrl =
    "https://api.gdeltproject.org/api/v2/geo/geo?query=" +
    encodeURIComponent("(airstrike OR shelling OR \"armed clashes\")") +
    "&format=GeoJSON&timespan=2d";
  const gdeltP = probe(gdeltUrl, { "User-Agent": UA }).then((r) => {
    let features: number | undefined;
    if (r.text) { try { features = (JSON.parse(r.text)?.features ?? []).length; } catch { /* non-JSON */ } }
    return {
      status: r.status, ms: r.ms, bytes: r.bytes, features, error: r.error,
      body: r.status !== 200 ? bodySnippet(r.text) : undefined,
      url: gdeltUrl,
      note: r.status === 0 ? "Unreachable / timed out (GDELT GEO is slow — the app allows 20 s)."
        : r.status !== 200 ? `HTTP ${r.status} from GDELT (body shown below tells us why).`
        : features === 0 ? "Reached GDELT but it returned 0 features right now (transient — retries next cycle)."
        : undefined,
    };
  });

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

  const [gdelt, gpsjam, acled] = await Promise.all([gdeltP, gpsjamP, diagnoseAcled()]);
  return NextResponse.json({ acled, gdelt, gpsjam, at: Date.now() });
}
