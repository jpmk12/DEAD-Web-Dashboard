import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEnergyQuotes } from "@/lib/energyPrices";

export const dynamic = "force-dynamic";

// Energy & commodity quotes (Brent/WTI/natgas/gold) for the Strategic Economics
// tab — the fuel/sustainment-cost signal. Keyless (Stooq), cached 15min server-side.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ quotes: [] }, { status: 401 });
  try {
    const quotes = await getEnergyQuotes();
    return NextResponse.json({ quotes });
  } catch {
    return NextResponse.json({ quotes: [] }, { status: 502 });
  }
}
