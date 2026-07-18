import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { WARNING_PROBLEMS } from "@/lib/warningTaxonomy";
import { assessWarning } from "@/lib/warningAssess";

export const dynamic = "force-dynamic";

// GET → scored Indications & Warning assessments for the active watch list.
// Each is calm by default; color is earned by the anomaly crossing a threshold.
// Lazy-ingest with a 10-min cache (no cron) — reads existing feeds server-side.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const problems = (
    await Promise.all(WARNING_PROBLEMS.map((p) => assessWarning(p.id).catch(() => null)))
  ).filter(Boolean);

  return NextResponse.json({ problems });
}
