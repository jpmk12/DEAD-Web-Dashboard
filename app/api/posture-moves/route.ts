import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPostureMoves } from "@/lib/postureMovesAssemble";

export const dynamic = "force-dynamic";

// Force-posture moves read from the defense feeds (lib/postureMoves, pure;
// lib/postureMovesAssemble, 15-min cache). Deterministic, no model call.
// Bounded: a cold sweep answers `pending` within ~8 s; callers poll.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getPostureMoves(8_000));
}
