import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getConvergence } from "@/lib/convergenceAssemble";

export const dynamic = "force-dynamic";

// Where several independent surfaces are pointing at one place. The gather
// lives in lib/convergenceAssemble.ts (shared with the OSINT command board's
// primer); the judgement in lib/convergence.ts (pure, tested). This route is
// a join, not a collector.

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await getConvergence(normEmail(session.user?.email));
  return NextResponse.json(body);
}
