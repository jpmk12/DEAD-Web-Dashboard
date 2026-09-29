import { NextResponse } from "next/server";
import { sessionUser } from "@/lib/currentUser";
import { noteOpen, listOpens } from "@/lib/surfaceOpens";
import { isOpenSurface } from "@/lib/openSignal";

export const dynamic = "force-dynamic";

// Open-tracking beyond news.
//   GET          → this user's open rows (the palette turns them into boosts)
//   POST {surface, id} → count one open; fire-and-forget from the client
// No model call, no fan-out — one indexed row either way.

export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ opens: await listOpens(user.email) });
}

export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { surface?: unknown; id?: unknown } | null;
  const surface = body?.surface;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!isOpenSurface(surface) || !id) return NextResponse.json({ error: "surface and id are required" }, { status: 400 });
  await noteOpen(user.email, surface, id);
  return new NextResponse(null, { status: 204 });
}
