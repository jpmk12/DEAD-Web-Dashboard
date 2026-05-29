import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { bumpLastSeen, getAllLastSeen, isValidSurface } from "@/lib/surfaceState";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const lastSeen = await getAllLastSeen();
  return NextResponse.json({ lastSeen });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { surface?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const surface = typeof body.surface === "string" ? body.surface : "";
  if (!isValidSurface(surface)) {
    return NextResponse.json({ error: "Invalid surface" }, { status: 400 });
  }

  const now = Date.now();
  await bumpLastSeen(surface, now);
  return NextResponse.json({ ok: true, lastSeenAt: now });
}
