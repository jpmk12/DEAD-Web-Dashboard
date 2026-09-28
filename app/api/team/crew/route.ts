import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { listCrewRows, upsertCrewRow, deleteCrewRow, validQual } from "@/lib/crewStore";
import { deriveAvailability, postureAgainstDemand, DEFAULT_QUALS } from "@/lib/crewState";
import { getDemandHorizon } from "@/lib/demandAssemble";
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

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [rows, demand] = await Promise.all([listCrewRows().catch(() => []), getDemandHorizon().catch(() => null)]);
  const summary = deriveAvailability(rows);
  const posture = postureAgainstDemand(
    summary,
    (demand?.outlooks ?? []).map((o) => ({ aor: o.aor, direction: o.direction, score: o.score })),
    AOR_LABELS as Record<string, string>,
  );
  return NextResponse.json({ summary, posture, defaults: DEFAULT_QUALS });
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
