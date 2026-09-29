import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import {
  listDecisions, listDueDecisions, createDecision, scoreDecision, deleteOpenDecision,
} from "@/lib/decisionStore";
import {
  validateDraft, hitRate, sortForDisplay, OUTCOMES,
  type DecisionCall, type DecisionOutcome,
} from "@/lib/decisionLog";
import { calibrateIndicators } from "@/lib/indicatorCalibration";

export const dynamic = "force-dynamic";

// The I&W decision log. Shared per problem like sitrep_limfacs — the crew
// maintains one board — and attributed by email.
//
// GET    ?problemId=…   → that problem's entries (display-ordered) + hit rate
// GET    ?due=1         → open entries past their horizon, across all problems
// POST   {problemId, indicatorId?, call, expectation, horizonDays}
// PATCH  {id, outcome, note?}
// DELETE ?id=…          → only your own, only while open

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  if (url.searchParams.get("due")) {
    const due = await listDueDecisions();
    return NextResponse.json({ due });
  }

  const problemId = url.searchParams.get("problemId")?.trim();
  if (!problemId) return NextResponse.json({ error: "problemId is required" }, { status: 400 });

  const entries = await listDecisions(problemId);
  return NextResponse.json({
    entries: sortForDisplay(entries),
    hitRate: hitRate(entries),
    // Per-indicator read of the same entries — which indicators are earning
    // their place. Proposals only; the board never re-weights itself.
    calibration: calibrateIndicators(entries),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  // The same validator the UI uses. A guard that exists only in the client is
  // not a guard — the rule from /api/family/event's anchored-date check.
  const err = validateDraft(body ?? {});
  if (err) return NextResponse.json({ error: err }, { status: 422 });

  const entry = await createDecision({
    problemId: String(body!.problemId),
    indicatorId: typeof body!.indicatorId === "string" && body!.indicatorId ? String(body!.indicatorId) : null,
    call: String(body!.call) as DecisionCall,
    expectation: String(body!.expectation).trim(),
    horizonDays: Number(body!.horizonDays),
    by: email,
  });
  if (!entry) return NextResponse.json({ error: "Could not save the call." }, { status: 500 });
  return NextResponse.json({ entry });
}

export async function PATCH(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { id?: unknown; outcome?: unknown; note?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const outcome = typeof body?.outcome === "string" && OUTCOMES.includes(body.outcome as DecisionOutcome)
    ? (body.outcome as DecisionOutcome) : null;
  if (!id || !outcome) {
    return NextResponse.json({ error: "id and a valid outcome are required" }, { status: 400 });
  }
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  // Scoring is ONE-WAY: the store only updates rows whose outcome is still
  // NULL. The point of the log is that it records what you thought at the
  // time, and a re-scoreable entry is one you can quietly make yourself right
  // about — so a repeat attempt is a conflict, not an update.
  const ok = await scoreDecision(id, outcome, note);
  if (!ok) return NextResponse.json({ error: "Already scored, or no longer open." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Your own, and only while open — for the same reason scoring is one-way.
  const ok = await deleteOpenDecision(id, email);
  if (!ok) return NextResponse.json({ error: "Not yours, or already scored." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
