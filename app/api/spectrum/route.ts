import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getSpectrumSummary } from "@/lib/spectrum";
import { diagnoseCyberSources } from "@/lib/cyberSources";
import { diagnoseSpaceSources } from "@/lib/spaceSources";
import { diagnoseSpaceTrack } from "@/lib/spaceTrack";
import { diagnoseRadar } from "@/lib/cloudflareRadar";

export const dynamic = "force-dynamic";

// The Spectrum rollup for the Glance tile: worst PNT / cyber / space
// indicator across the I&W boards + space-weather ops LED + KEV × vendors.
// Deterministic, cached, bounded (8 s; `pending` on a cold start — the tile
// asks again). `?diag=1` (owner-only) runs every cyber/space fetch from
// production and returns status + snippet + parsed count — the contracts
// could not be verified from the build sandbox.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const diag = new URL(req.url).searchParams.get("diag");
  if (diag === "radar") {
    // The short form: only the Cloudflare Radar rows — the full diag body is
    // long enough that a paste of it was cut off before the radar list twice.
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json({ radar: await diagnoseRadar() });
  }
  if (diag === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    const [cyber, space, spaceTrack, radar] = await Promise.all([diagnoseCyberSources(), diagnoseSpaceSources(), diagnoseSpaceTrack(), diagnoseRadar()]);
    return NextResponse.json({ cyber, space, spaceTrack, radar });
  }
  try {
    return NextResponse.json(await getSpectrumSummary({ maxWaitMs: 8_000 }));
  } catch (e) {
    console.error("spectrum failed:", e);
    return NextResponse.json({ error: "spectrum summary failed" }, { status: 502 });
  }
}
