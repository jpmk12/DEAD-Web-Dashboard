import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// RainViewer radar frame index for the Crisis map's optional precipitation/
// convection layer. Proxied server-side because the app CSP's connect-src does
// not allow api.rainviewer.com from the browser (the radar *tiles* load directly
// — img-src allows https). Returns the frame list (≈2h past, plus a nowcast
// when the index still carries one) + the tile host; keyless. Honest-fail:
// ok:false / empty frames WITH A REASON when unreachable, so the client can
// name the outage instead of drawing nothing (bug report 2026-10-27).
//
// RainViewer's free tier changed on 2026-01-01: max zoom 7, 100 requests per
// IP per minute, nowcast and satellite withdrawn, the `path` to be used as
// returned (never rebuilt from the timestamp). The sandbox cannot reach the
// host, so the shape is pinned from the published reference; the owner-only
// /api/osint/map-diag probes the index and one tile from production.
interface RvFrame { time?: number; path?: string }

const INDEX_URL = "https://api.rainviewer.com/public/weather-maps.json";
const TIMEOUT_MS = 8000;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ ok: false, frames: [], reason: "unauthorized" }, { status: 401 });
  try {
    const r = await fetch(INDEX_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return NextResponse.json({ ok: false, frames: [], status: r.status, reason: `index HTTP ${r.status}` });
    const j = (await r.json()) as { host?: string; radar?: { past?: RvFrame[]; nowcast?: RvFrame[] } };
    const host = j.host || "https://tilecache.rainviewer.com";
    const map = (arr: RvFrame[] | undefined, kind: "past" | "nowcast") =>
      (arr ?? []).filter((f) => typeof f.time === "number" && typeof f.path === "string").map((f) => ({ time: f.time!, path: f.path!, kind }));
    const past = map(j.radar?.past, "past");
    const nowcast = map(j.radar?.nowcast, "nowcast");
    const frames = [...past, ...nowcast];
    return NextResponse.json(
      {
        ok: frames.length > 0, host, frames, nowIdx: Math.max(0, past.length - 1), status: r.status,
        reason: frames.length > 0 ? null : "index answered with no radar frames — the response shape may have changed",
      },
      { headers: { "Cache-Control": "private, max-age=120" } },
    );
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return NextResponse.json({ ok: false, frames: [], status: 0, reason: timeout ? `index timed out after ${TIMEOUT_MS / 1000} s` : "index unreachable" });
  }
}
