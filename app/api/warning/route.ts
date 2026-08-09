import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { activeWarningProblems } from "@/lib/warningProblems";
import { assessWarning } from "@/lib/warningAssess";

export const dynamic = "force-dynamic";

// GET → scored Indications & Warning assessments for the active watch list.
// Each is calm by default; color is earned by the anomaly crossing a threshold.
// Lazy-ingest with a 10-min cache (no cron) — reads existing feeds server-side.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const active = await activeWarningProblems();
  const problems = (
    await Promise.all(active.map((p) => assessWarning(p.def.id).catch(() => null)))
  ).filter(Boolean);

  return NextResponse.json({ problems });
}
