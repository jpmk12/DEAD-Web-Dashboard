import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleSitrep, sitrepSummary, sitrepStub } from "@/lib/sitrep";

export const dynamic = "force-dynamic";

const WAIT_MS = 8_000;
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

// GET → compact status rollup for EVERY configured SITREP base — powers the
// multi-base LED tile strip and the Morning Brief "Base SITREP" block. Each
// base rides assembleSitrep's 10-min cache, so after the first hit this is
// cheap; a base whose assembly fails degrades to an all-UNKNOWN stub rather
// than dropping off the strip (a missing tile would read as "fine").

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await getUserPrefs().catch(() => null);
  const bases = prefs?.sitrepBases ?? [];
  if (bases.length === 0) return NextResponse.json({ bases: [] });

  // Bounded (the latency rule): a cold base assembles ~14 upstreams; past the
  // wait it answers its all-UNKNOWN stub flagged `pending` and the strip's
  // poll brings the real LEDs — the assembly keeps running into its cache.
  let pending = false;
  const summaries = await Promise.all(
    bases.map((b) => within(assembleSitrep(b).then(sitrepSummary), WAIT_MS).then((s) => {
      if (s) return s;
      pending = true;
      return sitrepStub(b);
    }).catch(() => sitrepStub(b)))
  );
  return NextResponse.json({ bases: summaries, ...(pending ? { pending: true } : {}) }, { status: pending ? 202 : 200 });
}
