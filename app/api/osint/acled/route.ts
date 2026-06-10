import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAcledEvents, acledConfigured } from "@/lib/acled";

export const dynamic = "force-dynamic";

// Structured conflict events (ACLED) for the Crisis map's "ACLED" layer.
// Requires ACLED_EMAIL / ACLED_PASSWORD in the env; without them this returns
// { configured: false, events: [] } and the layer stays empty (the GDELT
// "Conflict" layer still covers the keyless density read).
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ configured: false, events: [] }, { status: 401 });
  const events = await getAcledEvents();
  return NextResponse.json({ configured: await acledConfigured(), events });
}
