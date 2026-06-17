import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEnergyQuotes, diagnoseEnergy } from "@/lib/energyPrices";

export const dynamic = "force-dynamic";

// Energy & commodity quotes (Brent/WTI/natgas/gold) for the Strategic Economics
// tab — the fuel/sustainment-cost signal. Keyless (Yahoo Finance, Stooq
// fallback), cached 15min server-side. `?debug=1` (owner only) returns per-
// source HTTP status so a blank panel shows its real cause.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ quotes: [] }, { status: 401 });

  if (new URL(request.url).searchParams.get("debug") === "1") {
    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!owner || session.user.email?.toLowerCase() !== owner) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ diag: await diagnoseEnergy() });
  }

  try {
    const quotes = await getEnergyQuotes();
    return NextResponse.json({ quotes });
  } catch {
    return NextResponse.json({ quotes: [] }, { status: 502 });
  }
}
