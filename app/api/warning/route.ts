import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { activeWarningProblems } from "@/lib/warningProblems";
import { assessWarning } from "@/lib/warningAssess";

export const dynamic = "force-dynamic";

const WAIT_MS = 12_000;
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

// GET → scored Indications & Warning assessments for the active watch list.
// Each is calm by default; color is earned by the anomaly crossing a threshold.
// Lazy-ingest with a 10-min cache (no cron) — reads existing feeds server-side.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const active = await activeWarningProblems();
  // Bounded per board (~30 s worst case cold: four serial sensor reads, then
  // the own-source fan-out): a board past the wait is left out of THIS reply
  // and the body is `pending` so the tile re-asks; the assessment keeps
  // running into its 10-min cache.
  let pending = false;
  const problems = (
    await Promise.all(active.map((p) => within(assessWarning(p.def.id).catch(() => null), WAIT_MS).then((a) => { if (a === null) pending = true; return a; })))
  ).filter(Boolean);

  return NextResponse.json({ problems, ...(pending ? { pending: true } : {}) }, { status: pending && problems.length === 0 ? 202 : 200 });
}
