import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { diagnoseAcled } from "@/lib/acled";

export const dynamic = "force-dynamic";

// Live, in-app diagnostic for the three Crisis-map data sources, so "source
// down" / "no ACLED data" becomes a concrete status the owner can read and
// report. Run on demand from the ACLED settings card — does real fetches, so
// it's never part of the normal page load.

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

  // GDELT — the keyless conflict-density source. The live deployment showed a
  // generic Apache 404 on /api/v2/geo/geo (so the path is gone, not our query),
  // while the DOC endpoint returned GDELT's own 429 (alive but rate-limited to
  // 1 req / 5 s). Probe SERIALLY with >5 s spacing — both to respect that limit
  // and so a single-segment geo path gets a clean read instead of a self-
  // inflicted 429.
  const gdeltVariants: { label: string; url: string }[] = [
    { label: "geo/geo", url: "https://api.gdeltproject.org/api/v2/geo/geo?query=conflict&format=geojson&timespan=1d" },
    { label: "geo (single segment)", url: "https://api.gdeltproject.org/api/v2/geo?query=conflict&format=geojson&timespan=1d" },
    { label: "doc control", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=conflict&mode=artlist&format=json&timespan=1d&maxrecords=5" },
  ];
  const gdeltP = (async () => {
    const variants: { label: string; status: number; ms: number; features?: number; body?: string }[] = [];
    for (let i = 0; i < gdeltVariants.length; i++) {
      if (i > 0) await sleep(5_200); // GDELT: 1 request / 5 s
      const v = gdeltVariants[i];
      const r = await probe(v.url, { "User-Agent": UA });
      let features: number | undefined;
      if (r.status === 200 && r.text) { try { const j = JSON.parse(r.text); features = (j?.features ?? j?.articles ?? []).length; } catch { /* non-JSON */ } }
      variants.push({ label: v.label, status: r.status, ms: r.ms, features, body: r.status !== 200 ? bodySnippet(r.text) : undefined });
    }
    const liveGeo = variants.find((v) => v.label.startsWith("geo") && v.status === 200);
    const docOk = variants.find((v) => v.label === "doc control" && v.status === 200);
    return {
      variants,
      note: liveGeo ? `GEO works via "${liveGeo.label}" — repoint the app to that path.`
        : docOk ? "Every GEO path 404s but DOC 2.0 is alive — GDELT's GEO API has moved/retired; repoint the conflict layer to DOC or retire it."
        : "GEO 404s and DOC didn't return 200 either (likely the 1-req/5s rate limit) — re-run once.",
    };
  })();

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
