import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDemandHorizonBounded } from "@/lib/demandAssemble";
import { getDemandSkill } from "@/lib/demandVerifyAssemble";

export const dynamic = "force-dynamic";

/** Resolve to null if `p` has not settled within `ms` — skill is a footer, never a wait. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

// 7-day mobility-demand outlook per combatant command — deterministic, from
// the sensors already on the board (lib/demandHorizon.ts). No model call;
// 10-min cache in the lib. `sources` says which sensor families answered.
// `skill` scores the outlooks whose window has closed (lib/demandVerify);
// null when the scorer did not answer in time.
//
// BOUNDED (2026-10-05): a cold assembly is started and the route answers
// within ~8 s with what settled, else the last body flagged `pending`, else
// a `pending` stub — never a gateway 502. Callers poll while `pending`.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [body, skill] = await Promise.all([getDemandHorizonBounded(8_000), within(getDemandSkill(), 4_000)]);
  return NextResponse.json({ ...body, skill });
}
