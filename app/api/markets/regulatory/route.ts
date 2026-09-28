import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { getRegulatoryDocs, diagnoseFederalRegister, WINDOW_DAYS } from "@/lib/federalRegister";
import { enrich, summarize } from "@/lib/regulatorySignals";

export const dynamic = "force-dynamic";

// U.S. sanctions / export-control / tariff actions from the Federal Register,
// classified and flagged against the watched countries. Keyless, 6-h cached
// in the lib. `?diag=1` (owner-only) runs the real queries and returns
// status + snippet per query — the contract could not be verified from the
// dev sandbox, so this is how a wrong agency slug gets found.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json({ queries: await diagnoseFederalRegister() });
  }

  const prefs = await getUserPrefs().catch(() => null);
  const watched = Array.from(new Set([
    ...(prefs?.countriesOfInterest ?? []).map((c) => c.country),
    ...(prefs?.forceLocations ?? []).map((l) => l.country),
  ].map((s) => (s || "").trim()).filter(Boolean)));

  const r = await getRegulatoryDocs();
  const actions = enrich(r.docs, watched, new Date().toISOString().slice(0, 10));
  return NextResponse.json({
    live: r.live,
    failed: r.failed,
    fetchedAt: r.fetchedAt,
    windowDays: WINDOW_DAYS,
    sinceYmd: r.sinceYmd,
    watched,
    summary: summarize(actions),
    actions: actions.slice(0, 80),
  });
}
