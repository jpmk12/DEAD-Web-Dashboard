import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getSpectrumSummary } from "@/lib/spectrum";
import { diagnoseCyberSources } from "@/lib/cyberSources";
import { diagnoseSpaceSources } from "@/lib/spaceSources";

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
  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    const [cyber, space] = await Promise.all([diagnoseCyberSources(), diagnoseSpaceSources()]);
    return NextResponse.json({ cyber, space });
  }
  try {
    return NextResponse.json(await getSpectrumSummary({ maxWaitMs: 8_000 }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "spectrum failed" }, { status: 502 });
  }
}
