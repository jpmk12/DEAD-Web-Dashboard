import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getPostureMoves, diagnoseChatter } from "@/lib/postureMovesAssemble";

export const dynamic = "force-dynamic";

// Force-posture moves read from the defense feeds (lib/postureMoves, pure;
// lib/postureMovesAssemble, 15-min cache). Deterministic, no model call.
// Bounded: a cold sweep answers `pending` within ~8 s; callers poll.
// `?diag=chatter` (owner-only) is the lift-chatter tuning read over the own
// sources — matches, near misses, unknown places and designators — so the
// grammar can be tuned to the handles actually followed.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("diag") === "chatter") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json(await diagnoseChatter());
  }
  return NextResponse.json(await getPostureMoves(8_000));
}
