import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleFamilyDigest } from "@/lib/family";
import { listDeadlines, upsertDeadlines, setDeadlineState, pruneHandledDeadlines } from "@/lib/familyDeadlineStore";
import { mergeDeadlines, toView, sortDeadlines, rollup, todayYmd } from "@/lib/familyDeadlines";
import type { DeadlineState } from "@/lib/familyDeadlines";
import { listTrips } from "@/lib/trips";
import { findTripConflicts, conflictLine, type DatedItem } from "@/lib/familyTripConflict";

export const dynamic = "force-dynamic";

// The Family digest: school + household mail read once and reported as
// deadlines, per-person summaries, and dated items awaiting confirmation.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // OWNER ONLY. The digest embeds the roster — the user's children's names,
  // grades and schools — and would otherwise run the owner's roster as a
  // search against a crew member's own mailbox. Neither is acceptable.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const email = normEmail(session.user?.email);
  const prefs = await getUserPrefs(email).catch(() => null);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const digest = await assembleFamilyDigest(session.accessToken as string, prefs, email, { refresh });

  // Fold the live extraction into the persisted record. Before this, the
  // 14-day Gmail window WAS the memory: a form due in six weeks and mentioned
  // once disappeared from the board about a fortnight later while still being
  // due. The merge never resets a state the user set, and the stored rows —
  // not the extraction — are what the pane renders.
  const stored = await listDeadlines(email);
  const { upserts } = mergeDeadlines(stored, digest.deadlines);
  await upsertDeadlines(email, upserts);
  pruneHandledDeadlines(email).catch(() => {});

  const byId = new Map(stored.map((d) => [d.id, d]));
  for (const u of upserts) byId.set(u.id, u);
  const today = todayYmd();
  const tracked = sortDeadlines([...byId.values()].map((d) => toView(d, today)));

  // "That deadline falls while you are away." The app has held trips and dated
  // family obligations side by side all along and never compared them — one
  // knows the date, the other knows the absence.
  const trips = await listTrips(email).catch(() => []);
  const dated: DatedItem[] = [
    ...tracked.map((d) => ({
      id: d.id, kind: "deadline" as const, title: d.title, dateISO: d.dueISO,
      personId: d.personId, handled: d.phase === "done" || d.phase === "dismissed",
    })),
    // Only anchored events — `needsConfirm` means the date is the model's guess,
    // and a conflict asserted from a guess is worse than none.
    ...(digest.events ?? [])
      .filter((e) => !e.needsConfirm && e.startISO)
      .map((e, i) => ({
        id: `ev-${i}`, kind: "event" as const, title: e.title,
        dateISO: (e.startISO ?? "").slice(0, 10), personId: e.personId ?? null,
      })),
  ];
  const conflicts = findTripConflicts(dated, trips.map((t) => ({
    id: t.id, label: t.label, startDate: t.startDate, endDate: t.endDate,
  })));

  return NextResponse.json({
    ...digest, tracked, rollup: rollup(tracked),
    tripConflicts: conflicts, tripConflictLine: conflictLine(conflicts),
  });
}

// PATCH { id, state } — record how the user handled a deadline. This is the
// only write; the extractor never sets state.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const body = await req.json().catch(() => null) as { id?: unknown; state?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const state = body?.state === "done" || body?.state === "dismissed" || body?.state === "open"
    ? (body.state as DeadlineState) : null;
  if (!id || !state) return NextResponse.json({ error: "id and a valid state are required" }, { status: 400 });

  const ok = await setDeadlineState(normEmail(session.user?.email), id, state);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
