import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getChokepointReads } from "@/lib/chokepointReads";

export const dynamic = "force-dynamic";

// Chokepoint interdiction, graded rather than counted.
//
// The old surface counted keyword mentions, so a tanker struck by a missile and
// an op-ed about the strait scored the same. lib/chokepointReads.ts joins two
// things the app already holds and had never compared — chokepoint coordinates
// and georeferenced conflict events — and grades the text by MOOD so a declared
// act outranks a declared intention, which outranks somebody's think piece.
// No model call; 15-min cache in the lib, shared with the demand horizon.

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Which chokepoints to read. The Economy tab asks for all; the I&W sensors
  // ask for the one their board watches, so a board never pays for eight.
  const want = new URL(req.url).searchParams.get("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const body = await getChokepointReads(want);
  return NextResponse.json(body);
}
