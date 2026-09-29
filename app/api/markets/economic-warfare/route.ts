import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEconomicWarfare } from "@/lib/economicWarfareAssess";

export const dynamic = "force-dynamic";

// The Economy tab's actor board: who is using economic leverage against whom,
// graded (act > threat > analysis) and scored as an anomaly against each
// actor's own baseline through the I&W engine. Deterministic — no model call —
// and 10-min cached in the lib, so a page open costs nothing new.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getEconomicWarfare());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "economic-warfare failed" }, { status: 502 });
  }
}
