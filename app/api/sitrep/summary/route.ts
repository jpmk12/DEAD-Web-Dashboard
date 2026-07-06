import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleSitrep, sitrepSummary, type SitrepSummary } from "@/lib/sitrep";
import type { SitrepBase } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET → compact status rollup for EVERY configured SITREP base — powers the
// multi-base LED tile strip and the Morning Brief "Base SITREP" block. Each
// base rides assembleSitrep's 10-min cache, so after the first hit this is
// cheap; a base whose assembly fails degrades to an all-UNKNOWN stub rather
// than dropping off the strip (a missing tile would read as "fine").

function stub(base: SitrepBase): SitrepSummary {
  return {
    icao: base.icao,
    label: base.label,
    status: { wx: "u", ops: "u", threat: "u", infra: "u" },
    driver: "assembly failed — UNKNOWN",
    line: `${base.icao} assembly failed this cycle — status UNKNOWN, not clear.`,
    worse: [],
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await getUserPrefs().catch(() => null);
  const bases = prefs?.sitrepBases ?? [];
  if (bases.length === 0) return NextResponse.json({ bases: [] });

  const summaries = await Promise.all(
    bases.map((b) => assembleSitrep(b).then(sitrepSummary).catch(() => stub(b)))
  );
  return NextResponse.json({ bases: summaries });
}
