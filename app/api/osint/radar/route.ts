import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// RainViewer radar frame index for the Crisis map's optional precipitation/
// convection layer. Proxied server-side because the app CSP's connect-src does
// not allow api.rainviewer.com from the browser (the radar *tiles* load directly
// — img-src allows https). Returns the frame list (≈2h past + ~30m nowcast) +
// the tile host; keyless. Honest-fail: ok:false / empty frames when unreachable,
// so the client hides the layer rather than fabricating a loop.
interface RvFrame { time?: number; path?: string }

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ ok: false, frames: [] }, { status: 401 });
  try {
    const r = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return NextResponse.json({ ok: false, frames: [] });
    const j = (await r.json()) as { host?: string; radar?: { past?: RvFrame[]; nowcast?: RvFrame[] } };
    const host = j.host || "https://tilecache.rainviewer.com";
    const map = (arr: RvFrame[] | undefined, kind: "past" | "nowcast") =>
      (arr ?? []).filter((f) => typeof f.time === "number" && typeof f.path === "string").map((f) => ({ time: f.time!, path: f.path!, kind }));
    const past = map(j.radar?.past, "past");
    const nowcast = map(j.radar?.nowcast, "nowcast");
    const frames = [...past, ...nowcast];
    return NextResponse.json(
      { ok: frames.length > 0, host, frames, nowIdx: Math.max(0, past.length - 1) },
      { headers: { "Cache-Control": "private, max-age=120" } },
    );
  } catch {
    return NextResponse.json({ ok: false, frames: [] });
  }
}
