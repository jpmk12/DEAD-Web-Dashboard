import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDemandHorizon } from "@/lib/demandAssemble";

export const dynamic = "force-dynamic";

// 7-day mobility-demand outlook per combatant command — deterministic, from
// the sensors already on the board (lib/demandHorizon.ts). No model call;
// 10-min cache in the lib. `sources` says which sensor families answered.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await getDemandHorizon();
  return NextResponse.json(body);
}
