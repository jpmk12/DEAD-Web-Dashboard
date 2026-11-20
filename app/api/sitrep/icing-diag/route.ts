import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { diagnoseFieldWx } from "@/lib/fieldWx";
import { fetchWithTimeout } from "@/lib/fetchTimeout";
import { decodeTaf } from "@/lib/metar";
import { parseTafHazards, icingGroupLabel, turbGroupLabel } from "@/lib/tafGroups";

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
  const [wx, taf] = await Promise.all([diagnoseFieldWx(base.icao, base.lat, base.lon), tafDiag(base.icao)]);
  return NextResponse.json({ ...(wx as object), taf });
}

// The raw TAF and the military icing groups read from it (6IchhhT) — at a USAF
// field abroad (ETAD) this is the forecaster's own icing statement.
async function tafDiag(icao: string): Promise<unknown> {
  try {
    const res = await fetchWithTimeout(`https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`, { headers: { Accept: "application/json" }, cache: "no-store" }, 10_000);
    const rows = res.ok ? await res.json() : null;
    const t = Array.isArray(rows) && rows.length ? decodeTaf(rows[0]) : null;
    if (!t) return { status: res.status, raw: null };
    const hz = parseTafHazards(t.raw, t.issuedAt, Date.now());
    return {
      status: res.status, raw: t.raw, issued: t.issuedAt, headerRead: hz.ok, military: hz.military,
      // ASCII only — a diag is pasted through pipes that mangle arrows and dashes.
      groups: hz.groups.map((g) => `${g.code} | ${g.change || "base"} | ${span(g)} | ${ascii(icingGroupLabel(g))}`),
      turbulence: hz.turbulence.map((g) => `${g.code} | ${g.change || "base"} | ${span(g)} | ${ascii(turbGroupLabel(g))}`),
      shear: hz.shear.map((g) => `${g.code} | ${g.change || "base"} | ${span(g)} | ${g.heightFtAgl} ft AGL ${String(g.windDir).padStart(3, "0")}/${g.windKt} kt`),
    };
  } catch (e) { return { status: 0, error: e instanceof Error ? e.message : String(e) }; }
}

const span = (g: { fromMs: number; toMs: number }) => `${new Date(g.fromMs).toISOString().slice(5, 16)}Z -> ${new Date(g.toMs).toISOString().slice(5, 16)}Z`;
const ascii = (t: string) => t.replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7e]/g, "");
