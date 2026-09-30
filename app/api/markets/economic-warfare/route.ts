import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getEconomicWarfare } from "@/lib/economicWarfareAssess";
import { diagnoseForeignSanctions } from "@/lib/foreignSanctions";

export const dynamic = "force-dynamic";

// The Economy tab's actor board: who is using economic leverage against whom,
// graded (act > threat > analysis) and scored as an anomaly against each
// actor's own baseline through the I&W engine. Deterministic — no model call —
// and 10-min cached in the lib, so a page open costs nothing new.
// `?diag=1` (owner-only) runs the EU/UK sanctions-list fetches from
// production and returns status + snippet + parsed count per source — the
// contract could not be verified from the dev sandbox.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json({ sources: await diagnoseForeignSanctions() });
  }
  // Bounded wait (8 s): the gateway's own timeout is shorter than a cold
  // assembly, and its HTML 502 is indistinguishable to the board from a
  // crashed route. `pending` bodies make the board ask again.
  try {
    return NextResponse.json(await getEconomicWarfare({ maxWaitMs: 8_000 }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "economic-warfare failed" }, { status: 502 });
  }
}
