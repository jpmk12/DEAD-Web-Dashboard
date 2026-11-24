import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { listCrewRows, upsertCrewRow, deleteCrewRow, validQual, snapshotCrewDay, getCrewHistory } from "@/lib/crewStore";
import { getDemandOutlookHistory } from "@/lib/demandStore";
import { crewTrend } from "@/lib/crewTrend";
import { deriveAvailability, postureAgainstDemand, DEFAULT_QUALS } from "@/lib/crewState";
import { getDemandHorizonBounded } from "@/lib/demandAssemble";
import { getDeclaredLinesBounded } from "@/lib/lineReadAssemble";
import { AOR_LABELS } from "@/lib/aor";

export const dynamic = "force-dynamic";

// Team state: crew counts per qualification level, and the posture-against-
// demand read. SHARED and crew-maintained (any allowlisted member updates the
// counts, attributed by email) — it is the squadron's board, and it holds no
// names. GET also returns posture lines joined to the 7-day demand horizon.
//   GET               → rows (derived availability), summary, posture
//   POST { row }      → upsert one qualification row
//   POST { op:"seed" }→ create the default qualification rows (empty counts)
//   DELETE ?qual=     → remove a row

let lastSnapshotDay: string | null = null;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [rows, demand, history, demandHistory, declared] = await Promise.all([
    listCrewRows().catch(() => []),
    // Bounded (2026-11-24): this GET awaited the whole cold demand assembly —
    // every board, posture, chokepoints — at page load. A pending answer
    // reads as no demand yet; the card's own horizon read fills in.
    getDemandHorizonBounded(3_000).catch(() => null),
    getCrewHistory(60).catch(() => []), getDemandOutlookHistory(60).catch(() => []),
    // Declared lines beside the forecast — bounded; null / empty changes nothing.
    getDeclaredLinesBounded(3_000).catch(() => null),
  ]);
  // Today's snapshot rides the read so the series exists on days nobody edits
  // — once per process day, not on every GET (the edits write their own).
  const day = new Date().toISOString().slice(0, 10);
  if (lastSnapshotDay !== day) { lastSnapshotDay = day; snapshotCrewDay(rows).catch(() => { lastSnapshotDay = null; }); }
  const summary = deriveAvailability(rows);
  const posture = postureAgainstDemand(
    summary,
    (demand?.outlooks ?? []).map((o) => ({ aor: o.aor, direction: o.direction, score: o.score })),
    AOR_LABELS as Record<string, string>,
    declared,
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = rows.map((r) => ({ day: today, qual: r.qual, total: r.total, crewRest: r.crewRest, onMission: r.onMission, dnif: r.dnif, other: r.other }));
  const trend = crewTrend([...history.filter((h) => h.day !== today), ...todayRows], demandHistory.map((d) => ({ day: d.day, aor: d.aor, direction: d.direction })), today);
  return NextResponse.json({ summary, posture, trend, defaults: DEFAULT_QUALS, ...(demand?.pending ? { demandPending: true } : {}) });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.op === "seed") {
    const existing = new Set((await listCrewRows().catch(() => [])).map((r) => r.qual));
    for (const d of DEFAULT_QUALS) {
      if (existing.has(d.qual)) continue;
      await upsertCrewRow({ qual: d.qual, label: d.label, total: 0, crewRest: 0, onMission: 0, dnif: 0, other: 0, sort: d.sort, by: email });
    }
    return NextResponse.json({ ok: true });
  }

  const r = (body.row ?? body) as Record<string, unknown>;
  if (!validQual(r.qual)) return NextResponse.json({ error: "qual must be 1-32 letters/digits" }, { status: 400 });
  await upsertCrewRow({
    qual: r.qual, label: typeof r.label === "string" ? r.label : "",
    total: Number(r.total), crewRest: Number(r.crewRest), onMission: Number(r.onMission), dnif: Number(r.dnif), other: Number(r.other),
    note: typeof r.note === "string" ? r.note : null, sort: Number(r.sort ?? 0), by: email,
  });
  listCrewRows().then(snapshotCrewDay).catch(() => {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const qual = new URL(req.url).searchParams.get("qual") ?? "";
  if (!validQual(qual)) return NextResponse.json({ error: "qual required" }, { status: 400 });
  await deleteCrewRow(qual);
  return NextResponse.json({ ok: true });
}
