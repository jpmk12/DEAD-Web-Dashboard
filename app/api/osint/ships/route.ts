import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureAisConnection, getVesselsSnapshot } from "@/lib/aisStream";

export const dynamic = "force-dynamic";

// Maritime vessel feed via the AISStream WebSocket bridge. Stateless from
// the client's perspective — each GET ensures the server-side WebSocket is
// connected, then returns the current vessel snapshot.
//
// Activation: requires AISSTREAM_API_KEY in the env. Without it the route
// returns { configured: false, ships: [] } and the client falls back to the
// iframe providers.

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ships: [] }, { status: 401 });

  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") || "38.85");
  const lon = parseFloat(url.searchParams.get("lon") || "-104.8");
  const radius = Math.min(500, Math.max(50, parseFloat(url.searchParams.get("radius") || "200")));

  // Never let a fault in the AIS bridge turn into a 500 → the client would
  // render it as a scary "Network error". Always answer with valid JSON.
  try {
    const status = ensureAisConnection(lat, lon, radius);
    const ships = status.configured ? getVesselsSnapshot() : [];
    return NextResponse.json({
      configured: status.configured,
      connected: status.connected,
      error: status.error,
      ships,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.error("[ships] route error:", err);
    return NextResponse.json({
      configured: true,
      connected: false,
      error: "AIS bridge error — retrying.",
      ships: [],
      fetchedAt: Date.now(),
    });
  }
}
