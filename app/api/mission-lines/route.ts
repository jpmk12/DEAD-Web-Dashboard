import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { listLines, upsertLine, deleteLine } from "@/lib/missionLineStore";
import { getLineReads, resetLineReadsCache } from "@/lib/lineReadAssemble";
import { validateLineDraft, normalizeLineDraft, todayZulu, addDaysYmd, LINE_HORIZON_DAYS } from "@/lib/missionLines";
import { resolveAirfield } from "@/lib/resolveAirfield";

export const dynamic = "force-dynamic";

// Mission lines — a day, an airframe, the fields, a status. Shared and
// crew-maintained (any allowlisted member), attributed by email, the
// crew_state model. Deliberately coarse: the validator refuses tails,
// callsigns, loads, times and any extra key at this boundary.
//   GET ?read=1       → the horizon's lines joined to the app's readings
//   GET               → the horizon's lines (raw)
//   POST {day, airframe, fields, status, id?} → create / update one line
//   DELETE ?id=       → remove a line

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("read") === "1") {
    const body = await getLineReads({ maxWaitMs: 8_000, force: url.searchParams.get("refresh") === "1" });
    return NextResponse.json(body, { status: body.lines === null ? 503 : 200 });
  }
  const today = todayZulu();
  const lines = await listLines(today, addDaysYmd(today, LINE_HORIZON_DAYS - 1));
  if (lines === null) return NextResponse.json({ error: "Lines unavailable — the store did not answer.", unavailable: true }, { status: 503 });
  return NextResponse.json({ today, lines });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { id, ...rest } = body;
  const err = validateLineDraft({ ...rest, ...(id !== undefined ? { id } : {}) }, { nowMs: Date.now() });
  if (err) return NextResponse.json({ error: err }, { status: 422 });
  const draft = normalizeLineDraft(rest);
  // Placement is checked, never guessed: an ICAO the app cannot place still
  // saves (the read marks it UNKNOWN) and the reply names it.
  const unresolved: string[] = [];
  await Promise.all(Array.from(new Set(draft.fields)).map(async (f) => {
    const r = await resolveAirfield(f).catch(() => null);
    if (!r) unresolved.push(f);
  }));
  const line = await upsertLine(draft, email, typeof id === "string" ? id : undefined);
  if (!line) return NextResponse.json({ error: "Could not save the line — the store did not answer." }, { status: 503 });
  resetLineReadsCache();
  return NextResponse.json({ line, unresolved });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteLine(id);
  if (!ok) return NextResponse.json({ error: "Not found, or the store did not answer." }, { status: 409 });
  resetLineReadsCache();
  return NextResponse.json({ ok: true });
}
