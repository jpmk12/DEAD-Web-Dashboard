import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getAllLastSeen, bumpLastSeen } from "@/lib/surfaceState";
import { computeDelta } from "@/lib/oeDelta";
import { buildOeSeries, OE_WINDOW_DAYS } from "@/lib/oeDeltaAssemble";
import { listOpens } from "@/lib/surfaceOpens";
import { attentionGaps } from "@/lib/attentionGaps";

export const dynamic = "force-dynamic";

// What changed in the operational environment since you last looked.
//
// A join over three daily history tables the app already writes — force
// posture, base SITREP LEDs, I&W levels — anchored on the surface_state
// last-seen primitive. No model call, no upstream fetch: every read here is one
// indexed query on data already stored, so this is cheap enough to sit on the
// front door. Series assembly lives in lib/oeDeltaAssemble.ts, shared with the
// assistant's OE context (which reads without bumping).
//
// The "oe" surface is bumped AFTER the delta is computed, so this visit becomes
// the baseline for the next one. Bumping first would compare now with now.
//
// `attention` (PLAN §8 F) joins the same series to THIS user's surface_opens:
// subjects that worsened since they last opened them. Per user by
// construction; the shared OE brief export never carries it.

export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [lastSeen, series, opens] = await Promise.all([
    getAllLastSeen(email).catch(() => ({} as Record<string, number>)),
    buildOeSeries(),
    listOpens(email).catch(() => []),
  ]);

  const delta = computeDelta(series, (lastSeen as Record<string, number>).oe);
  const attention = attentionGaps(opens, series);

  // This look becomes the next baseline. Fire-and-forget — a failed bump must
  // not fail the read.
  bumpLastSeen(email, "oe").catch(() => {});

  return NextResponse.json({ ...delta, attention, scanned: { series: series.length, windowDays: OE_WINDOW_DAYS } });
}
